-- Disposable database ONLY, after accepted A/B, Phase C, notification schema,
-- and 20261114140000_item02_delivery_integration.sql. Fixtures roll back.
-- These exercise integration/claims, not a replacement for canonical-score tests.
begin;
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.assert_true(value boolean, label text) returns text language plpgsql as $$
begin
  if value is distinct from true then raise exception 'FAIL: %',label; end if;
  return 'PASS: '||label;
end $$;

create temp table actor as
select '7d000000-0000-4000-8000-000000000001'::uuid uid,
  (date_trunc('week',clock_timestamp() at time zone 'Europe/London')::date-7) wk,
  (select name from pg_timezone_names where name like 'Etc/GMT%'
    and extract(hour from clock_timestamp() at time zone name)=12 limit 1) zone,
  (select name from pg_timezone_names where name like 'Etc/GMT%'
    and extract(hour from clock_timestamp() at time zone name)=22 limit 1) quiet_zone;
select pg_temp.assert_true(zone is not null and quiet_zone is not null,'test timezones resolved') from actor;
insert into auth.users(id) select uid from actor;
insert into public.user_profile(user_id,timezone,push_notifications_enabled,manual_pro_grant)
  select uid,zone,true,false from actor
  on conflict(user_id) do update set timezone=excluded.timezone,push_notifications_enabled=true;
insert into public.notification_preferences(user_id,notification_type,enabled)
  select uid,'weekly_score',true from actor
  on conflict(user_id,notification_type) do update set enabled=true;

-- Installed Phase C activation is not bypassed, even when a saved row exists.
update public.streak_reconciliation_state set activation_at=clock_timestamp()+interval '2 days'
  where user_id=(select uid from actor);
select pg_temp.assert_true(public.reconcile_and_capture_weekly_report(uid,wk)->>'reason'='streak_not_current',
  'pre-activation reconciliation cannot capture') from actor;
select pg_temp.assert_true(not exists(select 1 from public.weekly_report_snapshots r where r.user_id=uid),
  'scheduled activation leaves no partial snapshot') from actor;

-- Saved fixture: only tests release/identity/permissions; never fabricates a
-- live report or claims these sample scores came from canonical calculation.
insert into public.weekly_report_snapshots(user_id,reporting_week_start,delivery_at,captured_at,payload)
select uid,wk,release_at,release_at,jsonb_build_object('version',2,
 'period',jsonb_build_object('weekStart',wk,'weekEndExclusive',wk+7,
   'startsAt',wk::timestamp at time zone 'UTC','endsAtExclusive',(wk+7)::timestamp at time zone 'UTC',
   'accountTimezone','UTC','scoringModel','integration-fixture'),
 'deliveryAt',release_at,'capturedAt',release_at,'cutoffAt',release_at,
 'pillars','{}'::jsonb,'comparison','{}'::jsonb,'details','{}'::jsonb)
from actor cross join lateral(select ((wk+6)::timestamp+interval '18 hours') at time zone 'Europe/London' release_at) x;

create temp table first_claim as select public.claim_notification_delivery(uid,'weekly_score',zone,'weekly-report:'||wk) id from actor;
select pg_temp.assert_true(id is not null,'eligible saved report receives a claim') from first_claim;
select pg_temp.assert_true(public.claim_notification_delivery(uid,'weekly_score',zone,'weekly-report:'||wk)=(select id from first_claim),
  'same-day retries use original provider idempotency key') from actor;
update public.notification_delivery_claims set local_day=local_day-1 where id=(select id from first_claim);
select pg_temp.assert_true(public.claim_notification_delivery(uid,'weekly_score',zone,'weekly-report:'||wk)=(select id from first_claim),
  'cross-day retry retains the original claim UUID') from actor;
select pg_temp.assert_true((select count(*) from public.notification_delivery_claims where user_id=uid)=1,
  'one weekly identity across days') from actor;

update public.user_profile set timezone=(select quiet_zone from actor) where user_id=(select uid from actor);
select pg_temp.assert_true(public.claim_notification_delivery(uid,'weekly_score',quiet_zone,'weekly-report:'||wk) is null,
  'quiet hours defer even pending delivery') from actor;
update public.user_profile set timezone=(select zone from actor) where user_id=(select uid from actor);
update public.notification_preferences set enabled=false where user_id=(select uid from actor) and notification_type='weekly_score';
select pg_temp.assert_true(public.claim_notification_delivery(uid,'weekly_score',zone,'weekly-report:'||wk) is null,
  'disabled preference prevents delivery') from actor;
select pg_temp.assert_true(exists(select 1 from public.weekly_report_snapshots where user_id=uid),
  'preference changes do not erase the report') from actor;
update public.notification_preferences set enabled=true where user_id=(select uid from actor) and notification_type='weekly_score';
select pg_temp.assert_true(public.claim_notification_delivery(uid,'weekly_score',zone,'scheduled') is null,
  'obsolete Sunday path cannot claim') from actor;
select pg_temp.assert_true(public.claim_notification_delivery(uid,'weekly_score',zone) is null,
  'legacy three-argument wrapper also rejects obsolete weekly path') from actor;
select pg_temp.assert_true(public.claim_notification_delivery(uid,'weekly_score',zone,'weekly-report:'||(wk+7)) is null,
  'missing snapshot cannot send') from actor;
select public.complete_notification_delivery(id,'isolated-provider-receipt') from first_claim;
select pg_temp.assert_true(public.claim_notification_delivery(uid,'weekly_score',zone,'weekly-report:'||wk) is null,
  'completed delivery cannot repeat') from actor;
select pg_temp.assert_true(public.claim_notification_delivery(uid,'journal_prompt',zone,'scheduled') is not null,
  'other notification types preserve installed claims') from actor;

select pg_temp.assert_true(not has_function_privilege('authenticated','public.reconcile_and_capture_weekly_report(uuid,date)','execute')
  and not has_function_privilege('anon','public.list_item02_due_accounts(date)','execute'), 'trusted work is not client callable');
select pg_temp.assert_true(not has_function_privilege('service_role','public.claim_notification_delivery_before_item02(uuid,text,text,text)','execute')
  and not has_function_privilege('service_role','public.read_checkin_streak_status_before_item02(uuid)','execute'), 'internal wrappers remain private');
select pg_temp.assert_true(jsonb_array_length(public.read_checkin_streak_status(uid)->'calendarDays')=7,
  'calendar labels come from the canonical account calendar') from actor;
do $$ begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000002',true);
  begin
    perform public.read_checkin_streak_status((select uid from actor));
    raise exception 'FAIL: cross-account read was allowed';
  exception when insufficient_privilege then null; end;
end $$;
select 'PASS: cross-account read rejected';
rollback;
