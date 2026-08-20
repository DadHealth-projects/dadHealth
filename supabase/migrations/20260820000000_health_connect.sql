-- Add the tokenless Android Health Connect provider without changing existing
-- Garmin, Fitbit, Apple Health, notification, or cron behaviour.

alter table public.body_metrics
drop constraint if exists body_metrics_source_check;
alter table public.body_metrics
add constraint body_metrics_source_check
check (source in ('manual', 'garmin', 'fitbit', 'apple_health', 'health_connect'));

alter table public.sleep_logs
drop constraint if exists sleep_logs_source_check;
alter table public.sleep_logs
add constraint sleep_logs_source_check
check (source in ('manual', 'garmin', 'fitbit', 'apple_health', 'health_connect'));

alter table public.user_integrations
drop constraint if exists user_integrations_provider_check;
alter table public.user_integrations
add constraint user_integrations_provider_check
check (provider in ('garmin', 'fitbit', 'apple_health', 'health_connect'));

alter table public.user_integrations
alter column access_token drop not null,
alter column refresh_token drop not null;

alter table public.user_integrations
drop constraint if exists user_integrations_tokens_check;
alter table public.user_integrations
add constraint user_integrations_tokens_check check (
  (provider in ('garmin', 'fitbit') and access_token is not null and refresh_token is not null)
  or
  (provider in ('apple_health', 'health_connect') and access_token is null and refresh_token is null)
);

-- Atomically import Health Connect daily aggregates. A manual value anywhere
-- on the same local date always wins; non-manual rows retain the existing
-- last-successful-wearable-sync behaviour.
create or replace function public.upsert_health_connect_daily_data(
  p_metrics jsonb default '[]'::jsonb,
  p_sleep jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  metrics_written int := 0;
  sleep_written int := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with written as (
    insert into public.body_metrics (user_id, metric_type, value, recorded_at, source)
    select
      current_user_id,
      metric.metric_type,
      metric.value,
      metric.recorded_at,
      'health_connect'
    from jsonb_to_recordset(coalesce(p_metrics, '[]'::jsonb))
      as metric(metric_type text, value numeric, recorded_at timestamptz)
    where metric.metric_type in ('steps', 'active_mins', 'resting_hr')
      and metric.value >= 0
      and not exists (
        select 1
        from public.body_metrics existing
        where existing.user_id = current_user_id
          and existing.metric_type = metric.metric_type
          and existing.recorded_at::date = metric.recorded_at::date
          and existing.source = 'manual'
      )
    on conflict (user_id, metric_type, recorded_at)
    do update set
      value = excluded.value,
      source = excluded.source
    where body_metrics.source <> 'manual'
    returning 1
  )
  select count(*) into metrics_written from written;

  with written as (
    insert into public.sleep_logs (user_id, date, hours, source)
    select
      current_user_id,
      sleep.date,
      sleep.hours,
      'health_connect'
    from jsonb_to_recordset(coalesce(p_sleep, '[]'::jsonb))
      as sleep(date date, hours numeric)
    where sleep.hours > 0
      and sleep.hours <= 24
    on conflict (user_id, date)
    do update set
      hours = excluded.hours,
      source = excluded.source
    where sleep_logs.source <> 'manual'
    returning 1
  )
  select count(*) into sleep_written from written;

  return jsonb_build_object(
    'metrics_written', metrics_written,
    'sleep_written', sleep_written
  );
end;
$$;

revoke execute on function public.upsert_health_connect_daily_data(jsonb, jsonb) from public;
grant execute on function public.upsert_health_connect_daily_data(jsonb, jsonb) to authenticated;
