-- Isolated database only. Real repository tables/functions; all fixtures roll back.
-- The two policy functions' wall clocks are frozen transactionally for boundaries.
begin;
create extension if not exists pgtap;
select plan(22);
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values ('03000000-0000-4000-8000-000000000001','item03@example.invalid');
update public.user_profile set timezone='Europe/London',push_notifications_enabled=true
 where user_id='03000000-0000-4000-8000-000000000001';
-- Fixture account was already London before all tested dates. The real timezone
-- update trigger correctly schedules changes for next week, so establish history.
delete from public.scoring_timezone_history where user_id='03000000-0000-4000-8000-000000000001';
insert into public.scoring_timezone_history values ('03000000-0000-4000-8000-000000000001','-infinity','-infinity','Europe/London');
insert into public.notification_preferences(user_id,notification_type,enabled,send_time)
select '03000000-0000-4000-8000-000000000001',t,true,
 case when t='morning_checkin' then time '08:00' else null end
from unnest(array['morning_checkin','lowest_pillar','trial_ending','community_reply','weekly_score']) t
on conflict(user_id,notification_type) do update set enabled=true,send_time=excluded.send_time;
create function pg_temp.freeze_clock(at_time timestamptz) returns void language plpgsql as $$
declare f text; definition text; begin
 foreach f in array array['public.item03_notification_context(uuid)','public.claim_item03_notification(uuid,text,text,text)'] loop
   definition:=pg_get_functiondef(f::regprocedure);
   -- Replacing earlier fixture literal allows multiple clock boundaries.
   definition:=regexp_replace(definition,'(''[^'']+''::timestamptz /\* test clock \*/|clock_timestamp\(\))',
     quote_literal(at_time)||'::timestamptz /* test clock */','g');
   execute definition;
 end loop;
end $$;
select pg_temp.freeze_clock('2026-11-16 08:00Z');
select is(public.item03_notification_context('03000000-0000-4000-8000-000000000001')->>'dailyType','morning_checkin','08:00 inclusive reminder');
select pg_temp.freeze_clock('2026-11-16 08:15Z');
select is(public.item03_notification_context('03000000-0000-4000-8000-000000000001')->>'dailyType',null,'08:15 exclusive drops daily');
select pg_temp.freeze_clock('2026-11-16 07:59Z');
select is(public.item03_notification_context('03000000-0000-4000-8000-000000000001')->>'allowed','false','before 08 quiet');
select pg_temp.freeze_clock('2026-11-16 21:00Z');
select is(public.item03_notification_context('03000000-0000-4000-8000-000000000001')->>'allowed','false','21 inclusive quiet');
select pg_temp.freeze_clock('2026-07-13 07:00Z');
select is(public.item03_notification_context('03000000-0000-4000-8000-000000000001')->>'dailyType','morning_checkin','BST 07UTC is 08 London');
select pg_temp.freeze_clock('2026-11-16 08:00Z');
create temp table original_claim as select public.claim_item03_notification('03000000-0000-4000-8000-000000000001','morning_checkin','daily:2026-11-16') id;
select ok((select id is not null from original_claim),'daily reservation succeeds');
select is(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','morning_checkin','daily:2026-11-16'),(select id from original_claim),'retry identical claim');
insert into public.mood_logs(user_id,date,mood_value) values ('03000000-0000-4000-8000-000000000001','2026-11-16',4);
select is(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','morning_checkin','daily:2026-11-16'),null::uuid,'completion suppresses unsent reminder');
select is(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','lowest_pillar','daily:2026-11-16','mind'),null::uuid,'daily reservation excludes pillar');
select isnt(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','community_reply','comment-a'),null::uuid,'community uses remaining slot');
select isnt(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','community_reply','comment-b'),null::uuid,'third shared slot');
select is(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','community_reply','comment-c'),null::uuid,'fourth shared slot denied');
select is(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','weekly_score','weekly-report:2026-11-09'),null::uuid,'missing saved week cannot send');
select is(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','streak_at_risk','scheduled'),null::uuid,'legacy streak warning suppressed');
select ok(not has_function_privilege('authenticated','public.claim_item03_notification(uuid,text,text,text)','execute'),'client cannot claim');
select ok(not has_function_privilege('anon','public.item03_notification_context(uuid)','execute'),'anon cannot read context');
select ok(not has_table_privilege('authenticated','public.notification_trial_episodes','select'),'private trial evidence');
select ok(has_function_privilege('service_role','public.record_notification_trial(uuid,uuid,text,timestamptz,timestamptz,text)','execute'),'trusted trial writer');
update public.notification_preferences set enabled=false where user_id='03000000-0000-4000-8000-000000000001' and notification_type='community_reply';
select is(public.claim_item03_notification('03000000-0000-4000-8000-000000000001','community_reply','comment-a'),null::uuid,'preference disables reserved retry');
update public.user_profile set push_notifications_enabled=false where user_id='03000000-0000-4000-8000-000000000001';
select is(public.item03_notification_context('03000000-0000-4000-8000-000000000001')->>'allowed','false','master consent enforced');
select ok(to_regclass('public.notification_weekly_report_identity') is not null,'weekly identity preserved');
select ok(to_regprocedure('public.claim_notification_delivery(uuid,text,text,text)') is not null,'old callable contract preserved');
select * from finish();
rollback;
