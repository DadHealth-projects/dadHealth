-- Disposable local database only. Uses installed repository schema and functions.
begin;
create extension if not exists pgtap;
select no_plan();
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values
 ('03200000-0000-4000-8000-000000000001','inbox-a@example.invalid'),
 ('03200000-0000-4000-8000-000000000002','inbox-b@example.invalid');
update public.user_profile set timezone='Europe/London',push_notifications_enabled=false
 where user_id in ('03200000-0000-4000-8000-000000000001','03200000-0000-4000-8000-000000000002');
delete from public.scoring_timezone_history where user_id in ('03200000-0000-4000-8000-000000000001','03200000-0000-4000-8000-000000000002');
insert into public.scoring_timezone_history values
 ('03200000-0000-4000-8000-000000000001','-infinity','-infinity','Europe/London'),
 ('03200000-0000-4000-8000-000000000002','-infinity','-infinity','Europe/London');
create function pg_temp.freeze_clock(at_time timestamptz) returns void language plpgsql as $$
declare f text; definition text; begin
 foreach f in array array['public.item03_inbox_context(uuid)','public.item03_notification_context(uuid)',
 'public.ensure_notification_inbox_event(uuid,text,text,text,text,jsonb)','public.claim_item03_notification(uuid,text,text,text)'] loop
  definition:=pg_get_functiondef(f::regprocedure);
  definition:=regexp_replace(definition,'(''[^'']+''::timestamptz /\* inbox clock \*/|clock_timestamp\(\))',
   quote_literal(at_time)||'::timestamptz /* inbox clock */','g');
  execute definition;
 end loop;
end $$;
select pg_temp.freeze_clock('2026-11-16 08:00Z');
select is(public.item03_inbox_context('03200000-0000-4000-8000-000000000001')->>'dailyType','morning_checkin','default reminder eligible without push consent');
select is(public.item03_notification_context('03200000-0000-4000-8000-000000000001')->>'allowed','false','push still requires master consent');
create temp table first_event as select public.ensure_notification_inbox_event('03200000-0000-4000-8000-000000000001',
 'morning_checkin','daily:2026-11-16','Daily check-in','How are you?',
 '{"version":"1","type":"morning_checkin","link":"/","destination_version":"1"}') value;
select ok((select value->>'id' is not null from first_event),'event saved before any push');
select is(public.ensure_notification_inbox_event('03200000-0000-4000-8000-000000000001',
 'morning_checkin','daily:2026-11-16','Changed','Changed','{"version":"1","type":"morning_checkin","link":"/","destination_version":"1"}'),
 (select value from first_event),'retry returns unchanged immutable event');
insert into public.mood_logs(user_id,date,mood_value) values ('03200000-0000-4000-8000-000000000001','2026-11-16',4);
select is(public.ensure_notification_inbox_event('03200000-0000-4000-8000-000000000001',
 'lowest_pillar','daily:2026-11-16','Mind','Reset','{"version":"1","type":"lowest_pillar","link":"/mind","destination_version":"1","pillar":"mind"}')->>'type',
 'morning_checkin','stored reminder wins after check-in even with push off');
update public.user_profile set push_notifications_enabled=true where user_id='03200000-0000-4000-8000-000000000001';
insert into public.notification_preferences(user_id,notification_type,enabled) values
 ('03200000-0000-4000-8000-000000000001','morning_checkin',true),('03200000-0000-4000-8000-000000000001','lowest_pillar',true)
 on conflict(user_id,notification_type) do update set enabled=true;
select is(public.item03_notification_context('03200000-0000-4000-8000-000000000001')->>'dailyType',null,'completion never substitutes second nudge');
select is(public.claim_item03_notification('03200000-0000-4000-8000-000000000001','lowest_pillar','daily:2026-11-16','mind'),null::uuid,'push obeys persisted winner');
select pg_temp.freeze_clock('2026-11-16 22:00Z');
select is(public.item03_notification_context('03200000-0000-4000-8000-000000000001')->>'allowed','false','quiet hours suppress push');
select isnt(public.ensure_notification_inbox_event('03200000-0000-4000-8000-000000000001','bedtime_story','bedtime:2026-11-16',
 'Bedtime','Story time','{"version":"1","type":"bedtime_story","link":"/bond"}')->>'id',null,'quiet hours do not suppress inbox');
select is(public.ensure_notification_inbox_event('03200000-0000-4000-8000-000000000001','streak_at_risk','suppressed',
 'Suppressed','Suppressed','{}'),null::jsonb,'streak warning stays suppressed');
select throws_ok($$select public.ensure_notification_inbox_event('03200000-0000-4000-8000-000000000001','bedtime_story','bad',
 'Bad','Bad','{"version":"1","type":"bedtime_story"}')$$,'22023','Invalid inbox destination','malformed destination rejected');
select ok(not has_table_privilege('authenticated','public.notification_inbox_events','insert'),'no client insert');
select ok(not has_table_privilege('authenticated','public.notification_inbox_events','update'),'no client read-state bypass');
select ok(not has_table_privilege('authenticated','public.notification_inbox_events','delete'),'no client delete');
select ok(not has_function_privilege('authenticated','public.ensure_notification_inbox_event(uuid,text,text,text,text,jsonb)','execute'),'server-only creation');
select ok(not has_function_privilege('anon','public.notification_inbox(text,uuid,timestamptz,uuid,integer)','execute'),'anonymous cannot read');
select throws_ok($$update public.notification_inbox_events set title='changed' where user_id='03200000-0000-4000-8000-000000000001'$$,
 '42501','Inbox content is immutable','immutable content enforced');
select lives_ok('select * from public.notification_inbox_retry_sources()','retry query uses actual repository source schema');
insert into public.posts(id,user_id,content,tag) values
 ('03200000-0000-4000-8000-000000000010','03200000-0000-4000-8000-000000000001','Local fixture','general');
insert into public.comments(id,user_id,post_id,content) values
 ('03200000-0000-4000-8000-000000000011','03200000-0000-4000-8000-000000000002','03200000-0000-4000-8000-000000000010','Reply');
insert into public.likes(user_id,post_id) values
 ('03200000-0000-4000-8000-000000000002','03200000-0000-4000-8000-000000000010');
select ok(exists(select 1 from public.notification_inbox_retry_sources() where type='community_reply' and record_id='03200000-0000-4000-8000-000000000011'),'failed reply event remains discoverable without push preference');
select ok(exists(select 1 from public.notification_inbox_retry_sources() where type='community_like' and record_id='03200000-0000-4000-8000-000000000010'),'like retry uses real source row');
delete from public.likes where post_id='03200000-0000-4000-8000-000000000010';
select ok(not exists(select 1 from public.notification_inbox_retry_sources() where type='community_like' and record_id='03200000-0000-4000-8000-000000000010'),'unlike removes pending source');
insert into public.co_parenting_schedules(id,user_id,co_parent_user_id) values
 ('03200000-0000-4000-8000-000000000012','03200000-0000-4000-8000-000000000001','03200000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','03200000-0000-4000-8000-000000000001',true);
insert into public.co_parenting_events(id,schedule_id,event_date,event_type,notification_actor_user_id) values
 ('03200000-0000-4000-8000-000000000013','03200000-0000-4000-8000-000000000012','2026-11-17','school','03200000-0000-4000-8000-000000000002');
select is((select notification_actor_user_id::text from public.co_parenting_events where id='03200000-0000-4000-8000-000000000013'),
 '03200000-0000-4000-8000-000000000001','server receipt actor overrides forged column');
select is((select actor_user_id::text from public.notification_inbox_retry_sources() where type='co_parent_event_added' and record_id='03200000-0000-4000-8000-000000000013'),
 '03200000-0000-4000-8000-000000000001','calendar retry preserves actor across webhook loss');
select pg_temp.freeze_clock('2026-11-16 22:01Z');
select public.ensure_notification_inbox_event('03200000-0000-4000-8000-000000000001','milestone_anniversary','milestone:one:2026',
 'Milestone one','First','{"version":"1","type":"milestone_anniversary","link":"/bond"}');
select public.ensure_notification_inbox_event('03200000-0000-4000-8000-000000000001','milestone_anniversary','milestone:two:2026',
 'Milestone two','Second','{"version":"1","type":"milestone_anniversary","link":"/bond"}');
select is((select count(*) from public.notification_inbox_events where type='milestone_anniversary'),2::bigint,'separate milestone/year identities');
set local role authenticated;
select set_config('request.jwt.claim.sub','03200000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.notification_inbox_events),0::bigint,'RLS hides other owner rows');
select is(public.notification_inbox()->>'unreadCount','0','RPC does not expose other owner count');
reset role;
select throws_ok(format('select public.notification_inbox(''read'',%L)',(select value->>'id' from first_event)),
 'P0002','Update unavailable','cross-owner acknowledgement rejected even with known ID');
select set_config('request.jwt.claim.sub','03200000-0000-4000-8000-000000000001',true);
select is(public.notification_inbox('count')->>'unreadCount','4','count includes all pages');
create temp table page_one as select public.notification_inbox('list',null,null,null,2) value;
select is(jsonb_array_length((select value->'items' from page_one)),2,'bounded first page');
create temp table page_two as select public.notification_inbox('list',null,
 (select (value->'items'->1->>'created_at')::timestamptz from page_one),(select (value->'items'->1->>'id')::uuid from page_one),2) value;
select is(jsonb_array_length((select value->'items' from page_two)),2,'keyset includes remaining rows with timestamp ties');
select ok(not exists(select 1 from page_one a,page_two b,jsonb_array_elements(a.value->'items') x,jsonb_array_elements(b.value->'items') y where x->>'id'=y->>'id'),'pages do not overlap');
-- Move test-created event times into the past for the real mark-all server cutoff.
select public.notification_inbox('read_all');
select is(public.notification_inbox('count')->>'unreadCount','0','mark all acknowledges owner rows');
select throws_ok($$select public.notification_inbox('read','03200000-0000-4000-8000-000000000099')$$,'P0002','Update unavailable','missing acknowledgement fails honestly');
select * from finish();
rollback;
