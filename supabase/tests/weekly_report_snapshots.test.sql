-- ISOLATED LOCAL SUPABASE ONLY. Never run against the linked production project.
-- Prerequisites: existing canonical migrations through 20261111130000, then the
-- new weekly_report_snapshots migration applied AND reapplied by the local runner.
-- No scoring configuration, activation date, function or policy is changed here.
-- These tests exercise the DISABLED publication gate and storage primitives.
-- They do not claim canonical capture/publication is implemented or proven.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('79000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'report-local@example.test', '', '2020-01-01', now());
insert into public.user_profile(user_id, timezone)
values ('79000000-0000-4000-8000-000000000001', 'UTC') on conflict(user_id) do update set timezone = 'UTC';

-- A complete synthetic payload inserted ONLY by the local test owner. The
-- service role has no INSERT permission and the gated RPC cannot publish it.
create function pg_temp.report_fixture() returns jsonb language sql as $$
  select '{
    "version":2,
    "period":{"weekStart":"2000-01-03","weekEndExclusive":"2000-01-10",
      "startsAt":"2000-01-03T00:00:00Z","endsAtExclusive":"2000-01-10T00:00:00Z",
      "accountTimezone":"UTC","scoringModel":"synthetic-storage-fixture"},
    "deliveryAt":"2000-01-09T18:00:00Z","capturedAt":"2000-01-09T18:00:00Z","cutoffAt":"2000-01-09T18:00:00Z",
    "comparison":{"state":"unavailable","reason":"snapshot_missing"},
    "pillars":{
      "mind":{"score":{"state":"available","value":0},"changePoints":{"state":"unavailable"}},
      "body":{"score":{"state":"available","value":0},"changePoints":{"state":"unavailable"}},
      "bond":{"score":{"state":"available","value":0},"changePoints":{"state":"unavailable"}}},
    "details":{"workouts":{"state":"available","value":0},"bondSessions":{"state":"available","value":0},
      "checkins":{"state":"available","value":0},"streak":{"days":{"state":"missing"},"protectedDates":[]},
      "narrative":null,"focus":null}}
  '::jsonb;
$$;
insert into public.weekly_report_snapshots(user_id,reporting_week_start,delivery_at,captured_at,payload)
values ('79000000-0000-4000-8000-000000000001','2000-01-03','2000-01-09T18:00:00Z','2000-01-09T18:00:00Z',pg_temp.report_fixture());

select ok((select relrowsecurity from pg_class where oid='public.weekly_report_snapshots'::regclass),'RLS enabled');
select ok(not has_table_privilege('authenticated','public.weekly_report_snapshots','SELECT'),'no direct client payload access');
select ok(not has_table_privilege('anon','public.weekly_report_snapshots','SELECT'),'no anonymous payload access');
select ok(not has_table_privilege('service_role','public.weekly_report_snapshots','INSERT'),'service cannot bypass publication gate');
select ok(not has_table_privilege('service_role','public.weekly_report_snapshots','UPDATE'),'service cannot rewrite snapshots');
select ok(not has_table_privilege('service_role','public.weekly_report_snapshots','DELETE'),'service cannot delete and recreate snapshots');
select ok(not has_function_privilege('authenticated','public.capture_weekly_report_snapshot(uuid,date)','EXECUTE'),'clients cannot capture another owner');
select ok(has_function_privilege('service_role','public.capture_weekly_report_snapshot(uuid,date)','EXECUTE'),'server can call gated capture');

select throws_ok($$update public.weekly_report_snapshots set payload=payload where user_id='79000000-0000-4000-8000-000000000001'$$,
  '55000','Weekly reports are immutable','even an owner update cannot rewrite a report');
select throws_ok($$insert into public.weekly_report_snapshots select * from public.weekly_report_snapshots where user_id='79000000-0000-4000-8000-000000000001'$$,
  '23505',null,'duplicate user/week rejected');
select throws_ok($$insert into public.weekly_report_snapshots values ('79000000-0000-4000-8000-000000000001','2000-01-10','2000-01-16T18:00:00Z','2000-01-16T18:00:00Z','{}')$$,
  '23514',null,'incomplete snapshot cannot be published');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.capture_weekly_report_snapshot('79000000-0000-4000-8000-000000000001','2000-01-03')->'snapshot',pg_temp.report_fixture(),'retry returns identical saved payload');
select is(public.capture_weekly_report_snapshot('79000000-0000-4000-8000-000000000001','2000-01-03')->'snapshot',pg_temp.report_fixture(),'repeat retry never rewrites observation');
select is(public.capture_weekly_report_snapshot('79000000-0000-4000-8000-000000000001','2000-01-10')->>'reason','canonical_capture_unverified','unsafe generation fails explicitly');
select is(public.capture_weekly_report_snapshot('79000000-0000-4000-8000-000000000001','2000-01-10')->>'reason','canonical_capture_unverified','failed generation is safe to retry');
select is((select count(*) from public.weekly_report_snapshots where user_id='79000000-0000-4000-8000-000000000001'),1::bigint,'failed generation writes no partial row');
select is(public.capture_weekly_report_snapshot('79000000-0000-4000-8000-000000000001',date_trunc('week',now())::date+7)->>'reason','not_released','cannot publish before release');
select throws_ok($$select public.capture_weekly_report_snapshot('79000000-0000-4000-8000-000000000099','2000-01-03')$$,
  '22023','Report account unavailable','unknown owner rejected');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"79000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.capture_weekly_report_snapshot('79000000-0000-4000-8000-000000000001','2000-01-03')$$,
  '42501','Service role required','function checks role even when called by local database owner');
select set_config('request.jwt.claims','{}',true);

-- Reproduce the canonical timestamp-cutoff limitation without altering config.
-- Use a week on/after BOTH effective models, whatever this isolated DB contains.
create function pg_temp.model_week() returns date language sql as $$
  select greatest(
    (select effective_week_start from public.mind_score_model_config where model_version='mind_70_30_v2'),
    (select effective_week_start from public.body_bond_score_model_config where model_version='body_bond_70_30_v3'));
$$;
create function pg_temp.body_score(p_end timestamptz) returns numeric language sql as $$
  select body_score from public.calculate_dad_score_period('79000000-0000-4000-8000-000000000001',
    pg_temp.model_week(),pg_temp.model_week()+7,pg_temp.model_week()::timestamp at time zone 'UTC',p_end);
$$;
-- Preserve the actual canonical empty-data result; do not assume it is zero.
create temporary table report_score_before_future on commit drop as
select pg_temp.body_score(((pg_temp.model_week()+6)::timestamp at time zone 'UTC') + interval '18 hours') as score;
insert into public.workout_sessions(user_id,exercise_name,duration_minutes,calories,performed_at)
values ('79000000-0000-4000-8000-000000000001','synthetic future-of-cutoff',10,0,
  ((pg_temp.model_week()+6)::timestamp at time zone 'UTC') + interval '19 hours');
select ok(pg_temp.body_score(((pg_temp.model_week()+6)::timestamp at time zone 'UTC') + interval '18 hours')
  > (select score from report_score_before_future),
  'canonical function includes a workout AFTER supplied Sunday timestamp cutoff: publication must remain gated');
select is(pg_temp.body_score(((pg_temp.model_week()+6)::timestamp at time zone 'UTC') + interval '18 hours'),
  pg_temp.body_score((pg_temp.model_week()+7)::timestamp at time zone 'UTC'),'timestamp cutoff cannot independently constrain canonical scoring');
delete from public.workout_sessions where user_id='79000000-0000-4000-8000-000000000001';
select is(pg_temp.body_score((pg_temp.model_week()+7)::timestamp at time zone 'UTC'),
  (select score from report_score_before_future),'deletion restores the original canonical result, not an invented zero');
select is((select payload from public.weekly_report_snapshots where user_id='79000000-0000-4000-8000-000000000001'),
  pg_temp.report_fixture(),'source mutation never silently rewrites a snapshot');

-- UK release and account boundaries are separate clocks.
select is(('2026-03-29 18:00'::timestamp at time zone 'Europe/London'),'2026-03-29T17:00:00Z'::timestamptz,'BST release');
select is(('2026-10-25 18:00'::timestamp at time zone 'Europe/London'),'2026-10-25T18:00:00Z'::timestamptz,'GMT release');
select is(public.scoring_week_boundary('79000000-0000-4000-8000-000000000001','2026-11-23'),
  '2026-11-23T00:00:00Z'::timestamptz,'existing UTC calendar is consumed unchanged');

select todo('Publication disabled: require reviewed writer and isolated SQL accuracy/concurrency proof',5);
select ok(false,'November 23 canonical capture parity for all three pillars and all sources');
select ok(false,'date-only future records, late creation/edit/deletion and offline replay at one MVCC observation');
select ok(false,'overseas Monday and timezone changes with first complete account-week baseline');
select ok(false,'two-connection concurrent generation and activity mutation produce one consistent snapshot');
select ok(false,'forced failure after score evaluation rolls back publication and supports retry');

-- Do not block existing account privacy cleanup with report immutability.
delete from auth.users where id='79000000-0000-4000-8000-000000000001';
select is((select count(*) from public.weekly_report_snapshots where user_id='79000000-0000-4000-8000-000000000001'),0::bigint,'account deletion removes private report');
select * from finish();
rollback;
