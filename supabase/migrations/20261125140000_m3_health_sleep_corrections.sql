-- Client native-health blocker 3: corrections and deletions for imported sleep.
-- The upsert RPCs accepted only hours > 0, so a sleep record deleted or moved in
-- Apple Health / Health Connect could never be cleared. The app now sends hours = 0
-- for a day only after a successful read with data; that clears ONLY the same
-- provider's imported row for that day (never manual entries or other sources).
-- Everything else is unchanged (bodies otherwise identical to the live versions,
-- verified by fingerprint on 2026-11-25). Owner is still auth.uid().
-- Rollback: re-run both function definitions from supabase/schema.sql.
begin;

create or replace function public.upsert_apple_health_daily_data(
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
  sleep_cleared int := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with written as (
    insert into body_metrics (user_id, metric_type, value, recorded_at, source)
    select
      current_user_id,
      metric.metric_type,
      metric.value,
      metric.recorded_at,
      'apple_health'
    from jsonb_to_recordset(coalesce(p_metrics, '[]'::jsonb))
      as metric(metric_type text, value numeric, recorded_at timestamptz)
    where metric.metric_type in ('steps', 'active_mins', 'resting_hr')
      and metric.value >= 0
      and not exists (
        select 1
        from body_metrics existing
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
    insert into sleep_logs (user_id, date, hours, source)
    select
      current_user_id,
      sleep.date,
      sleep.hours,
      'apple_health'
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

  -- A successful read with no sleep for a day (hours = 0) clears only this
  -- provider's imported row for that day. Manual entries and other sources are untouched.
  with cleared as (
    delete from sleep_logs existing
    using jsonb_to_recordset(coalesce(p_sleep, '[]'::jsonb)) as sleep(date date, hours numeric)
    where sleep.hours = 0
      and existing.user_id = current_user_id
      and existing.date = sleep.date
      and existing.source = 'apple_health'
    returning 1
  )
  select count(*) into sleep_cleared from cleared;

  return jsonb_build_object(
    'metrics_written', metrics_written,
    'sleep_written', sleep_written,
    'sleep_cleared', sleep_cleared
  );
end;
$$;

revoke execute on function public.upsert_apple_health_daily_data(jsonb, jsonb) from public;
grant execute on function public.upsert_apple_health_daily_data(jsonb, jsonb) to authenticated;

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
  sleep_cleared int := 0;
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

  -- A successful read with no sleep for a day (hours = 0) clears only this
  -- provider's imported row for that day. Manual entries and other sources are untouched.
  with cleared as (
    delete from sleep_logs existing
    using jsonb_to_recordset(coalesce(p_sleep, '[]'::jsonb)) as sleep(date date, hours numeric)
    where sleep.hours = 0
      and existing.user_id = current_user_id
      and existing.date = sleep.date
      and existing.source = 'health_connect'
    returning 1
  )
  select count(*) into sleep_cleared from cleared;

  return jsonb_build_object(
    'metrics_written', metrics_written,
    'sleep_written', sleep_written,
    'sleep_cleared', sleep_cleared
  );
end;
$$;

revoke execute on function public.upsert_health_connect_daily_data(jsonb, jsonb) from public;
grant execute on function public.upsert_health_connect_daily_data(jsonb, jsonb) to authenticated;

commit;
