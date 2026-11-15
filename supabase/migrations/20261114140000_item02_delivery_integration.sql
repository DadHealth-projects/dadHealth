-- Phase D integration only. Does not install a cron job or modify scoring.
begin;

alter table public.streak_reconciliation_state
  add column if not exists item02_selected_at timestamptz;

create or replace function public.reconcile_and_capture_weekly_report(p_user_id uuid, p_week_start date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare status jsonb; result jsonb; captured timestamptz;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if p_user_id is null or p_week_start is null or not isfinite(p_week_start) or extract(isodow from p_week_start)<>1 then
    raise exception 'Invalid report request' using errcode='22023';
  end if;
  -- Consistent ordering: streak lock then the existing A/B user/week lock.
  perform pg_advisory_xact_lock(hashtextextended('streak:'||p_user_id::text,0));
  status:=public.reconcile_checkin_streak(p_user_id);
  if status->>'state' is distinct from 'current' then
    return jsonb_build_object('state','unavailable','reason','streak_not_current');
  end if;
  -- A failed capture rolls back its own writes while retaining successful daily
  -- reconciliation, so a repeatedly failing account does not monopolize the batch.
  begin
  result:=public.capture_weekly_report_snapshot(p_user_id,p_week_start);
  if result->>'state'='available' then
    captured:=(result#>>'{snapshot,capturedAt}')::timestamptz;
    -- If midnight crossed between reconciliation and capture, roll back the
    -- capture rather than commit a snapshot with yesterday's count.
    if captured is null
  or (status->>'through')::date is null
      or (status->>'through')::date < public.scoring_date_at(p_user_id,captured)-1 then
      raise exception 'Streak reconciliation crossed a day boundary' using errcode='40001';
    end if;
    return jsonb_build_object('state','available','week',p_week_start);
  end if;
  return jsonb_build_object('state','unavailable','reason',result->>'reason');
  exception when others then
    return jsonb_build_object('state','unavailable','reason','capture_failed');
  end;
end $$;
revoke all on function public.reconcile_and_capture_weekly_report(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_and_capture_weekly_report(uuid,date) to service_role;

-- Select bounded work independently of push consent. Observation ordering keeps
-- pending accounts moving through the batch; unexpected reconciliation errors
-- are still reported and require operator attention.
create or replace function public.list_item02_due_accounts(p_week_start date)
returns table(user_id uuid) language plpgsql security definer set search_path=pg_catalog,public as $$
declare observed timestamptz:=clock_timestamp(); london_day date; latest date;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  london_day:=(observed at time zone 'Europe/London')::date;
  latest:=date_trunc('week',london_day)::date;
  if observed<((latest+6)::timestamp+interval '18 hours') at time zone 'Europe/London' then latest:=latest-7; end if;
  if p_week_start is distinct from latest then raise exception 'Invalid released week' using errcode='22023'; end if;
  return query
with picked as (
  select p.user_id from public.user_profile p
    join public.streak_reconciliation_state s on s.user_id=p.user_id
    where s.activation_at<=observed and (
      s.state<>'current' or s.reconciled_through is null
      or s.reconciled_through<public.scoring_date_at(p.user_id,observed)-1
      or not exists(select 1 from public.weekly_report_snapshots r where r.user_id=p.user_id and r.reporting_week_start=p_week_start)
      or (p.push_notifications_enabled and exists(select 1 from public.notification_preferences n
          where n.user_id=p.user_id and n.notification_type='weekly_score' and n.enabled)
        and not exists(select 1 from public.notification_delivery_claims c where c.user_id=p.user_id
          and c.type='weekly_score' and c.event_key='weekly-report:'||p_week_start::text and c.completed_at is not null)))
      order by s.item02_selected_at nulls first, p.user_id
  limit 100
  for update of s skip locked
)
update public.streak_reconciliation_state s
set item02_selected_at = observed
from picked
where s.user_id = picked.user_id
returning s.user_id;
end $$;
revoke all on function public.list_item02_due_accounts(date) from public,anon,authenticated,service_role;
grant execute on function public.list_item02_due_accounts(date) to service_role;

-- Keep other notification types on their installed implementation, unchanged.
do $$ begin
  if to_regprocedure('public.claim_notification_delivery_before_item02(uuid,text,text,text)') is null then
    alter function public.claim_notification_delivery(uuid,text,text,text) rename to claim_notification_delivery_before_item02;
  end if;
end $$;
revoke all on function public.claim_notification_delivery_before_item02(uuid,text,text,text) from public,anon,authenticated,service_role;
create unique index if not exists notification_weekly_report_identity
  on public.notification_delivery_claims(user_id,type,event_key)
  where type='weekly_score' and event_key like 'weekly-report:%';

create or replace function public.claim_notification_delivery(p_user_id uuid,p_type text,p_timezone text,p_event_key text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare existing public.notification_delivery_claims%rowtype; at_time timestamptz; day date; local_hour integer;
  reserved integer; legacy integer; claim_id uuid; wk date; zone text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if p_type is distinct from 'weekly_score' then
    return public.claim_notification_delivery_before_item02(p_user_id,p_type,p_timezone,p_event_key);
  end if;
  -- Reject the obsolete weekly scheduled path, including old server instances.
  if p_event_key is null or p_event_key !~ '^weekly-report:[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  wk:=substring(p_event_key from 15)::date;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  at_time:=clock_timestamp();
  select p.timezone into zone from public.user_profile p where p.user_id=p_user_id and p.push_notifications_enabled;
  if zone is null or btrim(zone)='' or zone is distinct from p_timezone
    or not exists(select 1 from pg_timezone_names where name=zone)
    or not exists(select 1 from public.notification_preferences p where p.user_id=p_user_id and p.notification_type='weekly_score' and p.enabled)
    or not exists(select 1 from public.weekly_report_snapshots r where r.user_id=p_user_id and r.reporting_week_start=wk and r.delivery_at<=at_time)
    then return null; end if;
  local_hour:=extract(hour from at_time at time zone zone);
  if local_hour>=21 or local_hour<8 then return null; end if;
  day:=(at_time at time zone zone)::date;
  select * into existing from public.notification_delivery_claims c
    where c.user_id=p_user_id and c.type=p_type and c.event_key=p_event_key;
  if found then
    if existing.completed_at is not null then return null; end if;
    if existing.local_day=day then return existing.id; end if;
  end if;
  select count(*) into reserved from public.notification_delivery_claims c where c.user_id=p_user_id and c.local_day=day;
  select count(*) into legacy from public.notification_log l where l.user_id=p_user_id and l.delivery_claim_id is null
    and (l.sent_at at time zone zone)::date=day;
  if reserved+legacy>=3 then return null; end if;
  if existing.id is not null then
    -- Same UUID / OneSignal idempotency key, charged against today's cap.
    update public.notification_delivery_claims set local_day=day where id=existing.id;
    return existing.id;
  end if;
  insert into public.notification_delivery_claims(user_id,type,local_day,event_key)
    values(p_user_id,p_type,day,p_event_key) returning id into claim_id;
  return claim_id;
end $$;
revoke all on function public.claim_notification_delivery(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_notification_delivery(uuid,text,text,text) to service_role;

-- Add canonical date labels without changing Phase C reconciliation semantics.
do $$ begin
  if to_regprocedure('public.read_checkin_streak_status_before_item02(uuid)') is null then
    alter function public.read_checkin_streak_status(uuid) rename to read_checkin_streak_status_before_item02;
  end if;
end $$;
revoke all on function public.read_checkin_streak_status_before_item02(uuid) from public,anon,authenticated,service_role;
create or replace function public.read_checkin_streak_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb; today date; monday date;
begin
  result:=public.read_checkin_streak_status_before_item02(p_user_id); -- retains owner check
  today:=public.scoring_date_at(p_user_id,statement_timestamp());
  monday:=date_trunc('week',today)::date;
  return result||jsonb_build_object('currentDate',today,'weekStart',monday,
    'calendarDays',(select jsonb_agg(monday+n order by n) from generate_series(0,6) n));
end $$;
revoke all on function public.read_checkin_streak_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_checkin_streak_status(uuid) to authenticated,service_role;
commit;
