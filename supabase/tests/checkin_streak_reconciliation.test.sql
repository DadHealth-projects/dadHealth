-- Disposable/local database only. Owner-controlled historical fixtures exercise
-- the private worker; public/service callers cannot supply observation times.
begin;
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.check_true(value boolean, label text) returns text language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if;
return 'PASS: '||label; end $$;
create function pg_temp.seed(n integer, pro boolean default true, zone text default 'Europe/London')
returns uuid language plpgsql as $$
declare uid uuid:=('7c000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
begin
  insert into auth.users(id) values(uid);
  insert into public.user_profile(user_id,timezone,manual_pro_grant) values(uid,zone,pro)
    on conflict(user_id) do update set timezone=excluded.timezone,manual_pro_grant=excluded.manual_pro_grant;
  delete from public.scoring_timezone_history where user_id=uid;
  insert into public.scoring_timezone_history values(uid,'-infinity','-infinity',zone);
  insert into public.user_streaks(user_id,streak_count,last_activity_date) values(uid,4,'2026-11-08')
    on conflict(user_id) do update set streak_count=4,last_activity_date='2026-11-08';
  update public.streak_reconciliation_state set activation_at='2026-11-09T00:00Z',start_date='2026-11-09',
    evidence_from='2026-11-08T00:00Z',baseline_count=4,baseline_last_date='2026-11-08',baseline_closed=false where user_id=uid;
  delete from public.streak_access_evidence where user_id=uid;
  insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access)
    values(uid,'manual','2026-11-08T00:00Z',pro);
  return uid;
end $$;
create function pg_temp.checkin(uid uuid, day date, receipt timestamptz) returns void language plpgsql as $$
begin
  insert into public.mood_logs(user_id,date,mood_value) values(uid,day,3) on conflict(user_id,date) do nothing;
  -- Synthetic historic receipt fixture; production roles cannot update this.
  update public.streak_checkin_receipts set received_at=receipt where user_id=uid and checkin_date=day;
end $$;
create temp table actors as select pg_temp.seed(1) as pro,pg_temp.seed(2,false) as free,pg_temp.seed(3) as repairs,
  pg_temp.seed(4) as expiry,pg_temp.seed(5) as unknown;

select pg_temp.checkin(pro,'2026-11-09','2026-11-09T12:00Z') from actors;
select pg_temp.check_true(public.apply_checkin_streak(pro,'2026-11-09T18:00Z')->>'count'='5','Monday check-in 4 to 5') from actors;
select pg_temp.check_true(public.apply_checkin_streak(pro,'2026-11-10T18:00Z')->>'count'='5','unfinished Tuesday is not missed') from actors;
select pg_temp.check_true(public.apply_checkin_streak(pro,'2026-11-11T00:00Z')->>'count'='5','Tuesday protection adds zero') from actors;
select pg_temp.check_true((select missed_date from public.user_streak_freezes where user_id=pro)='2026-11-10','protected date recorded') from actors;
select pg_temp.checkin(pro,'2026-11-11','2026-11-11T12:00Z') from actors;
select pg_temp.check_true(public.apply_checkin_streak(pro,'2026-11-11T18:00Z')->>'count'='6','Wednesday check-in 5 to 6') from actors;
select pg_temp.check_true(public.apply_checkin_streak(pro,'2026-11-13T00:00Z')->>'count'='0','second miss resets without a later check-in') from actors;
select pg_temp.checkin(pro,'2026-11-13','2026-11-13T12:00Z') from actors;
select pg_temp.check_true(public.apply_checkin_streak(pro,'2026-11-13T18:00Z')->>'count'='1','Friday restarts at one') from actors;
select pg_temp.check_true(public.apply_checkin_streak(pro,'2026-11-13T18:00Z')=public.apply_checkin_streak(pro,'2026-11-13T18:00Z'),'retry is identical') from actors;
select pg_temp.check_true((select count(*) from public.user_streak_freezes where user_id=pro)=1,'one freeze per week') from actors;
select pg_temp.check_true(public.apply_checkin_streak(free,'2026-11-10T00:00Z')->>'count'='0','Free miss resets') from actors;
select pg_temp.check_true(not exists(select 1 from public.user_streak_freezes where user_id=free),'Free consumes no protection') from actors;

-- Repairs release Tuesday's protection, making Thursday eligible, in date order.
select pg_temp.checkin(repairs,'2026-11-09','2026-11-09T12:00Z') from actors;
select pg_temp.checkin(repairs,'2026-11-11','2026-11-11T12:00Z') from actors;
select public.apply_checkin_streak(repairs,'2026-11-13T00:00Z') from actors;
select pg_temp.checkin(repairs,'2026-11-10','2026-11-13T00:00Z') from actors;
select pg_temp.check_true(public.apply_checkin_streak(repairs,'2026-11-13T00:00Z')->>'count'='7','48-hour boundary repair corrects later reset') from actors;
select pg_temp.check_true((select missed_date from public.user_streak_freezes where user_id=repairs)='2026-11-12','released freeze reallocated to Thursday') from actors;
update public.streak_checkin_receipts set received_at='2026-11-13T00:00:00.000001Z' where user_id=(select repairs from actors) and checkin_date='2026-11-10';
select pg_temp.check_true(public.apply_checkin_streak(repairs,'2026-11-13T00:00:01Z')->>'count'='0','one microsecond late cannot repair') from actors;
select pg_temp.check_true(exists(select 1 from public.mood_logs where user_id=repairs and date='2026-11-10'),'out-of-window check-in remains for scoring') from actors;
create temp table saved_receipt as select * from public.streak_checkin_receipts where user_id=(select repairs from actors) and checkin_date='2026-11-10';
delete from public.mood_logs where user_id=(select repairs from actors) and date='2026-11-10';
insert into public.mood_logs(user_id,date,mood_value) select repairs,'2026-11-10',3 from actors;
select pg_temp.check_true((select r.received_at=s.received_at from public.streak_checkin_receipts r join saved_receipt s using(user_id,checkin_date)),'delete/reinsert does not renew receipt') ;
select pg_temp.check_true(public.apply_checkin_streak(repairs,'2026-11-13T01:00Z')->>'count'='0','reinsert does not bypass expired repair') from actors;
update public.mood_logs set mood_value=4 where user_id=(select repairs from actors) and date='2026-11-09';
select pg_temp.check_true((select received_at from public.streak_checkin_receipts where user_id=repairs and checkin_date='2026-11-09')='2026-11-09T12:00Z','content edits preserve receipt') from actors;
delete from public.mood_logs where user_id=(select pro from actors) and date='2026-11-11';
select pg_temp.check_true(public.apply_checkin_streak(pro,'2026-11-11T18:00Z')->>'count'='5','deleting today retracts its contribution') from actors;
update public.mood_logs set date='2026-11-14' where user_id=(select pro from actors) and date='2026-11-13';
select pg_temp.check_true(exists(select 1 from public.streak_checkin_receipts where user_id=pro and checkin_date='2026-11-13')
  and exists(select 1 from public.streak_checkin_receipts where user_id=pro and checkin_date='2026-11-14'),'date move retains origin and stamps destination') from actors;

-- Eligibility reflects recorded facts at boundary, not today's access.
update public.streak_access_evidence set grants_access=false where user_id=(select expiry from actors);
insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access,expires_at)
  select expiry,'entitlement:test','2026-11-08T00:00Z',true,'2026-11-11T00:00Z' from actors;
select pg_temp.check_true(public.streak_access_at(expiry,'2026-11-10T00:00Z'),'verified unexpired access') from actors;
select pg_temp.check_true(not public.streak_access_at(expiry,'2026-11-11T00:00Z'),'expiry at boundary is not access') from actors;
insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access)
  select expiry,'manual','2026-11-12T00:00Z',true from actors;
select pg_temp.check_true(not public.streak_access_at(expiry,'2026-11-11T00:00Z'),'later manual upgrade cannot backdate') from actors;
select pg_temp.check_true(public.streak_access_at(expiry,'2026-11-12T00:00Z'),'manual grant effective at recorded instant') from actors;
delete from public.streak_access_evidence where user_id=(select unknown from actors);
select pg_temp.check_true(public.apply_checkin_streak(unknown,'2026-11-10T00:00Z')->>'state'='pending','missing evidence stays pending') from actors;
select pg_temp.check_true((select streak_count from public.user_streaks where user_id=unknown)=4,'unknown does not reset established output') from actors;
select pg_temp.check_true(public.read_checkin_streak_status(unknown)->'count'='null'::jsonb,'pending read never claims current count') from actors;

-- DST and canonical Monday timezone activation use actual calendar functions.
select pg_temp.check_true(public.streak_day_end(pro,'2026-03-29')='2026-03-29T23:00Z'::timestamptz,'UK spring day end') from actors;
select pg_temp.check_true(public.streak_day_end(pro,'2026-10-25')='2026-10-26T00:00Z'::timestamptz,'UK autumn day end') from actors;
select pg_temp.check_true(public.streak_day_end(pro,'2026-03-29')-public.streak_day_end(pro,'2026-03-28')=interval '23 hours','23-hour spring day') from actors;
select pg_temp.check_true(public.streak_day_end(pro,'2026-10-25')-public.streak_day_end(pro,'2026-10-24')=interval '25 hours','25-hour autumn day') from actors;
insert into public.scoring_timezone_history select pro,'2026-11-16','2026-11-16T08:00Z','America/Los_Angeles' from actors;
select pg_temp.check_true(public.streak_day_end(pro,'2026-11-15')='2026-11-16T08:00Z'::timestamptz,'westward Monday boundary is preserved') from actors;
select pg_temp.check_true(public.scoring_date_at(pro,'2026-11-16T04:00Z')='2026-11-15','overlap remains Sunday') from actors;
select pg_temp.check_true(public.streak_day_end(pro,'2026-11-16')='2026-11-17T08:00Z'::timestamptz,'new timezone used after activation') from actors;

-- Fresh-user setup: pre-boundary check-in updates the opening baseline once.
create temp table activation as select pg_temp.seed(6) as uid;
update public.streak_reconciliation_state set evidence_from=clock_timestamp(),
  activation_at=public.streak_day_end(user_id,public.scoring_date_at(user_id,clock_timestamp())),
  start_date=public.scoring_date_at(user_id,clock_timestamp())+1,baseline_last_date=null,baseline_count=0
  where user_id=(select uid from activation);
update public.user_streaks set streak_count=0,last_activity_date=null where user_id=(select uid from activation);
insert into public.mood_logs(user_id,date,mood_value) select uid,public.scoring_date_at(uid,clock_timestamp()),3 from activation;
select pg_temp.check_true((select baseline_count from public.streak_reconciliation_state where user_id=uid)=1,'setup-to-boundary check-in retained in baseline') from activation;
select pg_temp.check_true(public.build_checkin_streak(uid,(select activation_at from public.streak_reconciliation_state where user_id=uid))->>'count'='1','activation does not double count opening check-in') from activation;
select pg_temp.check_true((select received_at>transaction_timestamp() from public.streak_checkin_receipts where user_id=uid),'receipt uses actual clock, not transaction start') from activation;
select pg_temp.check_true((select count(*) from public.streak_checkin_receipts where user_id=uid)=1,'one receipt per date') from activation;

-- Append-only evidence trigger: ordinary verification does not append unchanged facts.
insert into public.subscription_entitlements(user_id,provider,provider_subscription_id,status,current_period_end)
  select uid,'apple','phase-c-local','active',clock_timestamp()+interval '2 days' from activation;
create temp table evidence_count as select count(*) n from public.streak_access_evidence where user_id=(select uid from activation);
update public.subscription_entitlements set last_verified_at=clock_timestamp() where provider_subscription_id='phase-c-local';
select pg_temp.check_true((select count(*) from public.streak_access_evidence where user_id=(select uid from activation))=(select n from evidence_count),'unchanged verification does not add evidence') ;
savepoint rejected_change;
update public.user_profile set manual_pro_grant=false where user_id=(select uid from activation);
rollback to rejected_change;
select pg_temp.check_true((select count(*) from public.streak_access_evidence where user_id=(select uid from activation))=(select n from evidence_count),'rolled-back grant change leaves no evidence');

-- A real evidence-write failure must roll back its source change atomically.
create function pg_temp.reject_evidence() returns trigger language plpgsql as $$
begin raise exception 'Local evidence failure' using errcode='P0002'; end $$;
create trigger phase_c_local_failure before insert on public.streak_access_evidence
  for each row execute function pg_temp.reject_evidence();
do $$ begin
  begin
    update public.user_profile set manual_pro_grant=false where user_id=(select uid from activation);
    raise exception 'Expected evidence failure';
  exception when no_data_found then null;
  end;
end $$;
drop trigger phase_c_local_failure on public.streak_access_evidence;
select pg_temp.check_true((select manual_pro_grant from public.user_profile where user_id=(select uid from activation)),
  'evidence error rolls back grant change');
select pg_temp.check_true((select count(*) from public.streak_access_evidence where user_id=(select uid from activation))=(select n from evidence_count),
  'evidence error leaves no partial fact');

-- New week allocation is independent; historical freezes are not deleted.
create temp table rollover as select pg_temp.seed(7) as uid;
insert into public.user_streak_freezes(user_id,week_start,missed_date)
  select uid,'2026-11-02','2026-11-05' from rollover;
select pg_temp.checkin(uid,d::date,d+interval '12 hours') from rollover,
  generate_series('2026-11-09'::timestamptz,'2026-11-15'::timestamptz,interval '1 day') d;
select public.apply_checkin_streak(uid,'2026-11-17T00:00Z') from rollover;
select pg_temp.check_true((select count(*) from public.user_streak_freezes where user_id=uid)=2,'new Monday gets a new allowance; old freeze preserved') from rollover;
select pg_temp.check_true((select streak_count from public.user_streaks where user_id=uid)=11,'Monday freeze retains seven earned check-in days') from rollover;
delete from public.mood_logs where user_id=(select uid from rollover) and date='2026-11-09';
select pg_temp.check_true(public.apply_checkin_streak(uid,'2026-11-17T00:00Z')->>'count'='10','deleting completed date retracts and replays later days') from rollover;
select pg_temp.check_true((select missed_date from public.user_streak_freezes where user_id=uid and week_start='2026-11-02')='2026-11-05','pre-activation freeze remains unchanged') from rollover;

-- Exercise the existing recipe completion, not a substitute test implementation.
insert into public.recipes(id,title,difficulty,age_min,prep_mins) values
  ('7c000000-0000-4000-8000-000000008001','Local fixture','easy',0,10);
create temp table cook as select pg_temp.seed(8) as uid;
update public.streak_reconciliation_state set activation_at=clock_timestamp()+interval '1 day',
  start_date=current_date+1,baseline_count=4,baseline_last_date=current_date-1 where user_id=(select uid from cook);
update public.user_streaks set streak_count=4,last_activity_date=current_date-1 where user_id=(select uid from cook);
select set_config('request.jwt.claim.sub',(select uid::text from cook),true);
create temp table before_cook as select streak_count from public.user_streaks where user_id=(select uid from cook);
select public.complete_cook_together_recipe('7c000000-0000-4000-8000-000000008001');
select pg_temp.check_true((select streak_count from public.user_streaks where user_id=(select uid from cook))=(select streak_count from before_cook),'Cook Together does not advance streak');
select pg_temp.check_true(exists(select 1 from public.bond_logs where user_id=(select uid from cook) and recipe_id='7c000000-0000-4000-8000-000000008001'),'Cook Together Bond reward preserved');
select pg_temp.check_true(exists(select 1 from public.body_metrics where user_id=(select uid from cook) and metric_type='active_mins' and value=10),'Cook Together activity reward preserved');

-- Existing Phase B table/immutability trigger, owner-created fixture. Phase C
-- must never modify reports when it later corrects the current streak.
insert into public.weekly_report_snapshots(user_id,reporting_week_start,delivery_at,captured_at,payload)
select uid,'2026-11-09','2026-11-15T18:00Z','2026-11-15T18:00Z',jsonb_build_object(
  'version',2,'period',jsonb_build_object('weekStart','2026-11-09','weekEndExclusive','2026-11-16',
    'startsAt','2026-11-09T00:00Z','endsAtExclusive','2026-11-16T00:00Z','accountTimezone','Europe/London','scoringModel','fixture'),
  'deliveryAt','2026-11-15T18:00Z','capturedAt','2026-11-15T18:00Z','cutoffAt','2026-11-15T18:00Z',
  'pillars','{}'::jsonb,'comparison','{}'::jsonb,'details',jsonb_build_object('streak',11)) from rollover;
create temp table preserved_snapshot as select payload from public.weekly_report_snapshots where user_id=(select uid from rollover);
select public.apply_checkin_streak(uid,'2026-11-17T00:00Z') from rollover;
select pg_temp.check_true((select payload from public.weekly_report_snapshots where user_id=(select uid from rollover))=(select payload from preserved_snapshot),'published report remains byte-equivalent after repair');

-- A moved row is judged by the destination receipt, not the original date's.
select pg_temp.checkin(repairs,'2026-11-12','2026-11-15T00:00:01Z') from actors;
delete from public.mood_logs where user_id=(select repairs from actors) and date='2026-11-12';
update public.mood_logs set date='2026-11-12' where user_id=(select repairs from actors) and date='2026-11-11';
select pg_temp.check_true((select received_at from public.streak_checkin_receipts where user_id=repairs and checkin_date='2026-11-12')='2026-11-15T00:00:01Z','date move cannot replace expired destination receipt') from actors;
select pg_temp.check_true(public.apply_checkin_streak(repairs,'2026-11-15T01:00Z')->>'count'='0','expired destination date cannot repair streak') from actors;

-- Permissions are exercised, not just inspected.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select pro::text from actors),true);
set local role authenticated;
select pg_temp.check_true(public.read_checkin_streak_status('7c000000-0000-4000-8000-000000000001')->>'state' in ('current','pending','scheduled'),'owner status readable');
do $$ begin
  begin perform public.read_checkin_streak_status('7c000000-0000-4000-8000-000000000002'); raise exception 'cross-user allowed';
    exception when insufficient_privilege then null; end;
  begin perform public.apply_checkin_streak('7c000000-0000-4000-8000-000000000001',now()); raise exception 'fabricated time allowed';
    exception when insufficient_privilege then null; end;
  begin insert into public.streak_checkin_receipts(user_id,checkin_date,received_at) values('7c000000-0000-4000-8000-000000000001',current_date,now()); raise exception 'receipt write allowed';
    exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.check_true(true,'cross-user, worker and receipt write attempts denied');
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select pg_temp.check_true(public.reconcile_checkin_streak('7c000000-0000-4000-8000-000000000001')->>'state' in ('current','pending'),'trusted reconciliation independently callable');
do $$ begin
  begin perform public.build_checkin_streak('7c000000-0000-4000-8000-000000000001',now()); raise exception 'service fabricated time allowed';
    exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.check_true(true,'service cannot choose observation time');
rollback;
