-- DISPOSABLE DATABASE ONLY. No external services. All fixture changes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if;
raise notice 'PASS: %',label; end $$;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('05000000-0000-4000-8000-000000000001','one@example.invalid',now(),'{}'),
 ('05000000-0000-4000-8000-000000000002','two@example.invalid',now(),'{}');
insert into public.journal_entries(user_id,content,prompt,mood_value) values
 ('05000000-0000-4000-8000-000000000001','fixture original',null,3),
 ('05000000-0000-4000-8000-000000000002','other owner private',null,3);
insert into public.posts(id,user_id,content,tag,author_name) values
 ('05000000-0000-4000-8000-000000000021','05000000-0000-4000-8000-000000000001','identifying post','general','Fixture author');
insert into public.comments(id,user_id,post_id,content,author_name) values
 ('05000000-0000-4000-8000-000000000022','05000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000021','identifying parent','Fixture author');
insert into public.comments(id,user_id,post_id,parent_id,content,author_name) values
 ('05000000-0000-4000-8000-000000000023','05000000-0000-4000-8000-000000000002','05000000-0000-4000-8000-000000000021','05000000-0000-4000-8000-000000000022','surviving reply','Other author');
insert into public.posts(id,user_id,content,tag,created_at) values
 ('05000000-0000-4000-8000-000000000024','05000000-0000-4000-8000-000000000001','unneeded leaf','general',now()-interval '2 hours'),
 ('05000000-0000-4000-8000-000000000025','05000000-0000-4000-8000-000000000002','other post','general',now()-interval '3 hours');
insert into public.comments(id,user_id,post_id,content) values
 ('05000000-0000-4000-8000-000000000026','05000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000025','owned leaf on other post');
insert into public.co_parenting_schedules(id,user_id,co_parent_user_id) values
 ('05000000-0000-4000-8000-000000000031','05000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000002'),
 ('05000000-0000-4000-8000-000000000032','05000000-0000-4000-8000-000000000002','05000000-0000-4000-8000-000000000001');
insert into public.co_parenting_events(schedule_id,event_date,event_type,notes) values
 ('05000000-0000-4000-8000-000000000032',current_date,'school','other parent private calendar note');
insert into public.notification_inbox_events(user_id,type,source_key,title,description,destination,created_at) values
 ('05000000-0000-4000-8000-000000000002','community_reply','privacy-fixture','fixture','attributable notification',
 '{"version":1,"type":"community_reply","post_id":"05000000-0000-4000-8000-000000000025","comment_id":"05000000-0000-4000-8000-000000000026"}',now());
-- Populate every allowlisted owner section using actual installed table constraints.
do $$
declare u uuid:='05000000-0000-4000-8000-000000000001'; w uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); ch uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid(); sub uuid:=gen_random_uuid();
begin
 insert into user_profile(user_id) values(u) on conflict(user_id) do nothing;
 insert into user_profile(user_id) values('05000000-0000-4000-8000-000000000002') on conflict(user_id) do nothing;
 update user_profile set child_age_band='primary' where user_id=u;
 insert into dad_dates(id,user_id,icon,name,age_range,budget,duration_minutes,source,description,distance_miles)
 values(gen_random_uuid(),u,'star','personal fixture','primary','free',30,'ai_search','saved personal description',2.5),
 (gen_random_uuid(),null,'star','shared admin fixture','primary','free',30,'admin','shared catalogue',null);
 insert into mood_logs(user_id,date,mood_value,mood_scale_version) values(u,current_date,3,1);
 insert into sleep_logs(user_id,date,hours) values(u,current_date,7);
 insert into activity_logs(user_id,client_request_id,pillar,activity_type,activity_date,duration_minutes,intensity) values(u,gen_random_uuid(),'body','walking',current_date,20,'light');
 insert into workouts(id,user_id,title,duration_mins,equipment,focus,source,access_level) values(w,u,'fixture workout',10,'none','full_body','ai_generated','pro');
 insert into workout_sessions(user_id,exercise_name,duration_minutes,calories,performed_at) values(u,'fixture exercise',10,20,now());
 insert into workout_completions(user_id,workout_id) values(u,w);
 insert into body_metrics(user_id,metric_type,value,recorded_at) values(u,'steps',100,now());
 insert into bond_logs(user_id,activity_type,quality) values(u,'play',3);
 insert into present_dad_sessions(user_id,ends_at) values(u,now()+interval '10 minutes');
 insert into present_dad_preferences(user_id) values(u) on conflict do nothing;
 insert into mind_reset_sessions(id,user_id,completed_at,activity_date,active_seconds) values(gen_random_uuid(),u,now(),current_date,60);
 insert into meal_plans(user_id) values(u);
 insert into mind_plans(id,user_id,version,copy_status,variant,actions,created_at,started_on) values(plan,u,'fixture','draft','balanced','[{},{},{},{},{},{},{}]',now(),current_date);
 insert into mind_plan_completions(user_id,action_number,completed_on,completed_at,timezone) values(u,1,current_date,now(),'Europe/London');
 insert into daily_tasks(user_id,title,date) values(u,'fixture task',current_date);
 insert into badges(id,icon,name) values(b,'star','fixture badge');
 insert into earned_badges(user_id,badge_id) values(u,b);
 insert into recipes(id,title,difficulty,age_min,prep_mins) values(r,'fixture recipe','easy',4,10);
 insert into user_saved_recipes(user_id,recipe_id) values(u,r);
 insert into user_streaks(user_id) values(u) on conflict do nothing;
 insert into user_streak_freezes(user_id,week_start,missed_date) values(u,'2026-11-16','2026-11-17');
 insert into scoring_timezone_history(user_id,effective_week_start,effective_at,timezone) values(u,'2026-11-16','2026-11-16T00:00:00Z','Europe/London') on conflict do nothing;
 insert into milestones(user_id,date,text,tag) values(u,current_date,'fixture milestone','family');
 insert into dad_day_searches(user_id,budget,child_age) values(u,'free','primary');
 insert into likes(user_id,post_id) values(u,'05000000-0000-4000-8000-000000000025');
 insert into comment_likes(user_id,comment_id) values(u,'05000000-0000-4000-8000-000000000023');
 insert into saved_posts(user_id,post_id) values(u,'05000000-0000-4000-8000-000000000025');
 insert into circles(id,icon,name) values(c,'star','fixture circle');
 insert into user_circles(user_id,circle_id) values(u,c);
 insert into weekly_challenges(id,title) values(ch,'fixture challenge');
 insert into weekly_challenge_participants(user_id,challenge_id,joined_at,completed_at) values(u,ch,now()-interval '1 hour',now());
 insert into notification_preferences(user_id,notification_type) values(u,'weekly_score') on conflict do nothing;
 insert into notification_inbox_events(user_id,type,source_key,title,description,destination,created_at) values(u,'community_reply','owner-fixture','fixture','fixture','{"version":1,"type":"community_reply"}',now());
 insert into subscription_entitlements(id,user_id,provider,provider_subscription_id,status) values(sub,u,'apple','item05-isolated-fixture','active');
 insert into subscription_cancellation_feedback(user_id,request_id,subscription_id,reason) values(u,gen_random_uuid(),sub,'other');
 -- Populate non-exported owner tables too: their removal is a separate requirement.
 insert into biometric_device_credentials(id,user_id,credential_digest) values(gen_random_uuid(),u,repeat('0',64));
 insert into ai_workout_generation_claims(user_id,usage_month,request_key,status) values(u,date_trunc('month',now())::date,'item05-fixture-key','pending');
 insert into subscription_account_links(user_id,provider,account_reference) values(u,'google',repeat('a',64));
 insert into subscription_trial_periods(subscription_id,user_id,started_at,ends_at) values(sub,u,now(),now()+interval '7 days') on conflict do nothing;
 insert into subscription_cancellation_evidence(subscription_id,user_id,source,snapshot_verified_at,scheduled_end_at)
 values(sub,u,'apple_renewal_disabled',now(),now()+interval '7 days') on conflict do nothing;
 insert into subscription_cancellation_confirmations(subscription_id,user_id,verified_at,access_end,evidence_kind)
 values(sub,u,now(),now()+interval '7 days','apple_renewal_disabled') on conflict do nothing;
 insert into notification_trial_episodes(user_id,subscription_id,provider,environment,transaction_id,started_at,ends_at,verified_at)
 values(u,sub,'apple','sandbox','item05-trial-fixture',now(),now()+interval '7 days',now());
 insert into notification_delivery_claims(user_id,type,local_day,event_key) values(u,'community_reply',current_date,'item05-claim-fixture');
 insert into notification_log(user_id,type) values(u,'community_reply');
 insert into streak_access_evidence(user_id,source_key,recorded_at,grants_access) values(u,'manual',now(),false);
 insert into streak_checkin_receipts(user_id,checkin_date,received_at) values(u,current_date,now()) on conflict do nothing;
 insert into streak_reconciliation_state(user_id,activation_at,start_date,evidence_from,baseline_count,state)
 values(u,now()+interval '1 day',current_date+1,now(),0,'scheduled') on conflict do nothing;
 insert into user_integrations(user_id,provider,access_token,refresh_token) values(u,'fitbit','isolated-fixture-not-a-token','isolated-fixture-not-a-token');
 insert into weekly_report_snapshots(user_id,reporting_week_start,delivery_at,captured_at,payload) values(u,'2026-11-09','2026-11-15T06:00:00Z','2026-11-15T06:00:00Z',
 '{"version":2,"deliveryAt":"2026-11-15T06:00:00Z","capturedAt":"2026-11-15T06:00:00Z","cutoffAt":"2026-11-15T06:00:00Z","period":{"weekStart":"2026-11-09","weekEndExclusive":"2026-11-16","startsAt":"2026-11-09T00:00:00Z","endsAtExclusive":"2026-11-16T00:00:00Z","accountTimezone":"Europe/London","scoringModel":"fixture"},"pillars":{},"comparison":{},"details":{}}');
end $$;
insert into storage.buckets(id,name) values('profile-photos','profile-photos') on conflict do nothing;
insert into storage.objects(bucket_id,name,owner_id) values
 ('profile-photos','05000000-0000-4000-8000-000000000001/fixture.png','05000000-0000-4000-8000-000000000001'),
 ('profile-photos','05000000-0000-4000-8000-000000000002/fixture.png','05000000-0000-4000-8000-000000000002');
select public.confirm_account_privacy_operation('05000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000011','export',repeat('a',64),'one@example.invalid',now()+interval '5 minutes');
select public.request_account_privacy_operation('05000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000011','export',repeat('a',64),repeat('b',64));
select public.request_account_privacy_operation('05000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000011','export',repeat('a',64),repeat('b',64));
select pg_temp.expect((select count(*)=1 from public.account_privacy_operations),'identical retry returns one operation');
select pg_temp.expect(public.account_privacy_status('05000000-0000-4000-8000-000000000011','05000000-0000-4000-8000-000000000002') is null,'cross-owner status denied');
select pg_temp.expect(public.account_privacy_status('05000000-0000-4000-8000-000000000011',null,repeat('b',64)) is null,'export recovery capability cannot disclose export');
create temporary table claimed as select * from public.claim_account_privacy_operations(1);
select pg_temp.expect(public.capture_account_export(id,lease_token),'capture succeeds against actual catalogue') from claimed;
do $$ declare section record; begin
 for section in select key,value from account_export_artifacts a,jsonb_each(a.payload->'sections') loop
  perform pg_temp.expect(jsonb_array_length(section.value)>0,'populated export section: '||section.key);
 end loop;
end $$;
create temporary table exported_owner_tables as select key as table_name from account_export_artifacts a,jsonb_each(a.payload->'sections') where key not in ('posts','comments','sharedCalendars','photoManifest');
create temporary table privacy_owner_inventory as
 select c.table_name from information_schema.columns c
 join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
 where c.table_schema='public' and c.column_name='user_id' and c.data_type='uuid'
 and t.table_type='BASE TABLE' and c.table_name not like 'account_%';
select pg_temp.expect((select count(*)>35 from privacy_owner_inventory),'deletion inventory includes non-exported owner tables');
select pg_temp.expect((select payload->'sections'->'user_profile'->0->>'child_age_band'='primary' from account_export_artifacts),'export includes child age band');
select pg_temp.expect((select payload->'sections'->'mood_logs'->0->>'mood_scale_version'='1' from account_export_artifacts),'export includes mood scale interpretation');
select pg_temp.expect((select jsonb_array_length(payload->'sections'->'dad_dates')=1 and payload->'sections'->'dad_dates'->0->>'description'='saved personal description' from account_export_artifacts),'personal Dad Days exported and admin catalogue excluded');
select pg_temp.expect((select payload->'sections'->'weekly_challenge_participants'->0->>'completed_at' is not null from account_export_artifacts),'export preserves challenge completion');
select pg_temp.expect((select jsonb_array_length(payload->'sections'->'photoManifest')=1 and payload->'sections'->'photoManifest'->0->>'path'='05000000-0000-4000-8000-000000000001/fixture.png' from account_export_artifacts),'photo manifest excludes other owner objects');
select pg_temp.expect((select jsonb_array_length(payload->'sections'->'journal_entries')=1 and payload->'sections'->'journal_entries'->0->'prompt'='null'::jsonb from public.account_export_artifacts),'owner-only export preserves null');
select pg_temp.expect((select payload::text not like '%other owner private%' from public.account_export_artifacts),'export excludes another owner content');
select pg_temp.expect((select jsonb_array_length(payload->'sections'->'sharedCalendars')=2 and payload::text not like '%other parent private calendar note%' from public.account_export_artifacts),'shared calendar exports only owner associations');
-- Exercise the large-download path with a real multi-byte dataset, then restore the original snapshot.
savepoint large_export_fixture;
delete from account_export_artifacts;
update account_privacy_operations set export_captured_at=null where kind='export';
update journal_entries set content=repeat(chr(128578),1500000) where user_id='05000000-0000-4000-8000-000000000001';
select pg_temp.expect(public.capture_account_export(id,lease_token),'large consistent capture succeeds') from claimed;
select pg_temp.expect((public.read_account_export_chunk('05000000-0000-4000-8000-000000000011','05000000-0000-4000-8000-000000000001',0,0)->>'bytes')::integer>5000000,'large capture exceeds normal response size');
select pg_temp.expect(length(public.read_account_export_chunk('05000000-0000-4000-8000-000000000011','05000000-0000-4000-8000-000000000001',0,65536)->>'text')=65536,'download chunk stays bounded by Unicode characters');
select pg_temp.expect((select length(payload->'sections'->'journal_entries'->0->>'content')=1500000 from account_export_artifacts),'large export retains the complete original text');
rollback to large_export_fixture;
savepoint expiry_fixture;
update public.account_export_artifacts set expires_at=clock_timestamp()-interval '1 second';
select pg_temp.expect(public.read_account_export('05000000-0000-4000-8000-000000000011','05000000-0000-4000-8000-000000000001') is null,'expired export cannot be downloaded');
select public.cleanup_account_privacy_retention();
select pg_temp.expect(not exists(select 1 from public.account_export_artifacts),'expired artifact is physically removed');
rollback to expiry_fixture;
update public.journal_entries set content='fixture edited later' where user_id='05000000-0000-4000-8000-000000000001';
select public.capture_account_export(id,lease_token) from claimed;
select pg_temp.expect((select payload->'sections'->'journal_entries'->0->>'content'='fixture original' from public.account_export_artifacts),'retry retains original immutable captured dataset');
update auth.users set email='changed@example.invalid' where id='05000000-0000-4000-8000-000000000001';
savepoint uncertain_handoff_fixture;
update account_privacy_operations set handoff_at=clock_timestamp() where kind='export';
select pg_temp.expect(public.authorize_account_export_send(id,lease_token) is null,'uncertain handoff cannot be retargeted after email change') from claimed;
select pg_temp.expect((select state='failed' and failure_code='delivery_reconciliation_required' and destination='one@example.invalid' from account_privacy_operations),'uncertain handoff preserves original destination for reconciliation');
rollback to uncertain_handoff_fixture;
select pg_temp.expect(public.authorize_account_export_send(id,lease_token) is null,'changed Auth email prevents authorization') from claimed;
select pg_temp.expect((select state='reconfirmation_required' and handoff_at is null from public.account_privacy_operations),'changed destination requires explicit reconfirmation');
select public.confirm_account_privacy_operation('05000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000012','delete',repeat('c',64),null,now()+interval '5 minutes');
select public.request_account_privacy_operation('05000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000012','delete',repeat('c',64),repeat('d',64));
select pg_temp.expect((select state='cancelled' from public.account_privacy_operations where kind='export'),'deletion cancels unhanded export');
select pg_temp.expect(public.read_account_export('05000000-0000-4000-8000-000000000011','05000000-0000-4000-8000-000000000001') is null,'deletion immediately disables artifact access');
-- Derived maintenance must become a no-op for this departing owner, not an error.
select public.refresh_effective_subscription_profile('05000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.record_streak_activity('05000000-0000-4000-8000-000000000001',current_date) is null,'accepted deletion skips streak maintenance');
savepoint maintenance_cleanup_fixture;
delete from subscription_entitlements where user_id='05000000-0000-4000-8000-000000000001';
delete from mood_logs where user_id='05000000-0000-4000-8000-000000000001';
select pg_temp.expect(not exists(select 1 from mood_logs where user_id='05000000-0000-4000-8000-000000000001'),'existing deletion triggers do not block check-in cleanup');
rollback to maintenance_cleanup_fixture;
insert into subscription_entitlements(user_id,provider,provider_subscription_id,status,current_period_end)
 values('05000000-0000-4000-8000-000000000002','apple','item05-other-owner-subscription','trialing',now()+interval '7 days');
select pg_temp.expect((select subscription_status='trialing' from user_profile where user_id='05000000-0000-4000-8000-000000000002'),'normal subscription maintenance still updates the surviving owner');

-- A surviving calendar can still carry the departed invited parent's actor UUID.
alter table public.co_parenting_events disable trigger stamp_notification_calendar_actor;
update public.co_parenting_events set notification_actor_user_id='05000000-0000-4000-8000-000000000001'
 where notes='other parent private calendar note';
alter table public.co_parenting_events enable trigger stamp_notification_calendar_actor;
update public.co_parenting_events set notification_actor_user_id=null where notes='other parent private calendar note';
select pg_temp.expect((select notification_actor_user_id='05000000-0000-4000-8000-000000000001'::uuid from co_parenting_events where notes='other parent private calendar note'),'ordinary updates cannot clear a removed calendar actor');

do $$ begin
 begin
  insert into public.journal_entries(user_id,content,mood_value) values('05000000-0000-4000-8000-000000000001','stale write',3);
  raise exception 'FAIL: deleting owner write accepted';
 exception when insufficient_privilege then raise notice 'PASS: stale owner write blocked'; end;
end $$;
select pg_temp.expect(not has_table_privilege('authenticated','public.account_privacy_operations','INSERT'),'client cannot create operations directly');
select pg_temp.expect(not has_table_privilege('authenticated','public.account_export_artifacts','SELECT'),'client cannot directly read captured JSON');
select pg_temp.expect(not has_function_privilege('authenticated','public.request_account_privacy_operation(uuid,uuid,text,text,text)','EXECUTE'),'client cannot invoke privileged request RPC');
select pg_temp.expect(not has_function_privilege('service_role','public.account_export_dataset(uuid)','EXECUTE'),'service cannot bypass locked capture RPC');
select pg_temp.expect(public.account_privacy_status('05000000-0000-4000-8000-000000000012',null,repeat('d',64))->>'state'='queued','delete capability exposes only safe status');
select pg_temp.expect(public.account_privacy_status('05000000-0000-4000-8000-000000000012',null,repeat('e',64)) is null,'wrong recovery capability denied');
select public.cleanup_account_privacy_retention();
select pg_temp.expect(not exists(select 1 from public.account_export_artifacts),'deletion cleanup removes temporary export');
truncate claimed;
insert into claimed select * from public.claim_account_privacy_operations(1);
select pg_temp.expect((select count(*)=1 from public.list_account_privacy_objects('05000000-0000-4000-8000-000000000001')),'storage cleanup inventory is owner scoped');
-- The real Storage API adapter is tested separately. Here remove fixture metadata
-- before the database cleanup, matching successful API removal without network.
delete from storage.objects where owner_id='05000000-0000-4000-8000-000000000001';
select pg_temp.expect(public.cleanup_account_private_records(id,lease_token),'private cleanup is atomic before Auth deletion') from claimed;
delete from auth.users where id='05000000-0000-4000-8000-000000000001';
do $$ declare t record; remaining bigint; begin
 for t in select table_name from privacy_owner_inventory loop
  execute format('select count(*) from public.%I where user_id=$1',t.table_name) into remaining using '05000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.expect(remaining=0,'owner rows removed: '||t.table_name);
 end loop;
end $$;
select pg_temp.expect(exists(select 1 from storage.objects where owner_id='05000000-0000-4000-8000-000000000002'),'other owner storage metadata survives');
select pg_temp.expect(not exists(select 1 from public.journal_entries where user_id='05000000-0000-4000-8000-000000000001'),'Auth deletion cascades private journal content');
select pg_temp.expect(exists(select 1 from public.journal_entries where user_id='05000000-0000-4000-8000-000000000002'),'other owner content survives deletion');
select pg_temp.expect(public.account_privacy_status('05000000-0000-4000-8000-000000000012',null,repeat('d',64)) is not null,'status capability survives Auth deletion');
select pg_temp.expect(exists(select 1 from public.account_deletion_tombstones where user_id='05000000-0000-4000-8000-000000000001'),'write barrier survives Auth deletion');
select pg_temp.expect((select content='' and user_id is null and author_name is null and removed_at is not null from public.posts where id='05000000-0000-4000-8000-000000000021'),'deleted post retains only empty thread structure');
select pg_temp.expect((select content='' and user_id is null and author_name is null and removed_at is not null from public.comments where id='05000000-0000-4000-8000-000000000022'),'deleted comment removes text and stored author identity');
select pg_temp.expect((select content='surviving reply' and parent_id='05000000-0000-4000-8000-000000000022'::uuid from public.comments where id='05000000-0000-4000-8000-000000000023'),'other author nested reply survives');
select pg_temp.expect(not exists(select 1 from public.posts where id='05000000-0000-4000-8000-000000000024'),'unneeded owned post is removed');
select pg_temp.expect(not exists(select 1 from public.comments where id='05000000-0000-4000-8000-000000000026'),'owned leaf on another post is removed');
select pg_temp.expect(exists(select 1 from public.posts where id='05000000-0000-4000-8000-000000000025'),'other post survives leaf cleanup');
select pg_temp.expect(not exists(select 1 from public.notification_inbox_events where source_key='privacy-fixture'),'comment notifications on other posts are removed');
select pg_temp.expect(not exists(select 1 from public.co_parenting_schedules where id='05000000-0000-4000-8000-000000000031'),'owned calendar removed');
select pg_temp.expect((select co_parent_user_id is null from public.co_parenting_schedules where id='05000000-0000-4000-8000-000000000032'),'invited association removed while calendar survives');
select pg_temp.expect(exists(select 1 from public.co_parenting_events where notes='other parent private calendar note'),'other parent event survives');
select pg_temp.expect((select notification_actor_user_id is null from public.co_parenting_events where notes='other parent private calendar note'),'authorised cleanup clears actor identity from surviving event');
select pg_temp.expect(exists(select 1 from dad_dates where name='shared admin fixture' and user_id is null),'shared Dad Days catalogue survives');
-- Operational retention never mistakes unfinished deletion for completed cleanup.
insert into public.account_privacy_operations(id,user_id,kind,recovery_hash,state,completed_at) values
 ('05000000-0000-4000-8000-000000000051','05000000-0000-4000-8000-000000000002','export',repeat('f',64),'failed',now()-interval '31 days');
select public.cleanup_account_privacy_retention();
select pg_temp.expect(not exists(select 1 from public.account_privacy_operations where id='05000000-0000-4000-8000-000000000051'),'completed operation details expire after thirty days');
select pg_temp.expect(exists(select 1 from public.account_privacy_operations where id='05000000-0000-4000-8000-000000000012'),'unfinished deletion survives retention cleanup');
update public.account_privacy_operations set lease_until=clock_timestamp()-interval '1 second' where id='05000000-0000-4000-8000-000000000012';
select pg_temp.expect((select count(*)=1 from public.claim_account_privacy_operations(1)),'expired worker lease is reclaimable');
select pg_temp.expect((select count(*)=0 from public.claim_account_privacy_operations(1)),'active worker lease is not double claimed');
rollback;
