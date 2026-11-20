-- Disposable database only. Synthetic fixtures; no email or network calls.
\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.reject(command text,code text,label text) returns void language plpgsql as $$begin
 begin execute command; exception when others then
 if sqlstate=code then raise notice 'PASS: %',label; return; end if; raise; end;
 raise exception 'FAIL: % unexpectedly succeeded',label; end $$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('b2000000-0000-4000-8000-000000000001','a@example.invalid','{}'),
 ('b2000000-0000-4000-8000-000000000002','b@example.invalid','{}'),
 ('b2000000-0000-4000-8000-000000000003','c@example.invalid','{}');
insert into circles(id,name,icon,visibility) values
 ('b2000000-0000-4000-8000-000000000010','Fixture private','community','private'),
 ('b2000000-0000-4000-8000-000000000011','Fixture public','community','public');
insert into user_circles(user_id,circle_id) values
 ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000011');
insert into posts(id,user_id,content,tag,anonymous,created_at,circle_id) values
 ('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000002','named','general',false,now()-interval '5 hours',null),
 ('b2000000-0000-4000-8000-000000000021',null,'anonymous','general',true,now()-interval '4 hours',null),
 ('b2000000-0000-4000-8000-000000000022','b2000000-0000-4000-8000-000000000002','private','general',false,now()-interval '3 hours','b2000000-0000-4000-8000-000000000010'),
 ('b2000000-0000-4000-8000-000000000023','b2000000-0000-4000-8000-000000000003','other thread','general',false,now()-interval '2 hours',null),
 ('b2000000-0000-4000-8000-000000000024','b2000000-0000-4000-8000-000000000002','public circle','general',false,now()-interval '1 hour','b2000000-0000-4000-8000-000000000011');
insert into anonymous_post_owners(post_id,user_id) values('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000002');
insert into comments(id,post_id,user_id,content,anonymous,parent_id) values
 ('b2000000-0000-4000-8000-000000000030','b2000000-0000-4000-8000-000000000023','b2000000-0000-4000-8000-000000000002','hidden parent',true,null),
 ('b2000000-0000-4000-8000-000000000031','b2000000-0000-4000-8000-000000000023','b2000000-0000-4000-8000-000000000003','surviving reply',false,'b2000000-0000-4000-8000-000000000030');
update comments set content=repeat('?',600) where id='b2000000-0000-4000-8000-000000000030';
select pg_temp.expect(not has_table_privilege('authenticated','community_reports','SELECT'),'reports not directly readable');
select pg_temp.expect(not has_table_privilege('authenticated','community_blocks','INSERT'),'no forged direct blocks');
select pg_temp.expect(not has_function_privilege('anon','submit_community_report(text,uuid,text,text)','EXECUTE'),'anonymous report denied');
select pg_temp.expect(not has_function_privilege('authenticated','community_target_author(text,uuid)','EXECUTE'),'private anonymous author lookup denied');
select pg_temp.expect(not has_function_privilege('authenticated','hold_community_report(uuid,text)','EXECUTE'),'client retention hold denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select pg_temp.reject($q$select submit_community_report('post','b2000000-0000-4000-8000-000000000022','spam','')$q$,'42501','private circle report denied');
select pg_temp.reject($q$select submit_community_report('post','b2000000-0000-4000-8000-000000000099','spam','')$q$,'42501','missing target denied');
select pg_temp.reject($q$select submit_community_report('post','b2000000-0000-4000-8000-000000000020','invented','')$q$,'22023','unknown reason denied');
select pg_temp.reject($q$select submit_community_report('post','b2000000-0000-4000-8000-000000000020','other',repeat('x',1001))$q$,'22023','long explanation denied');
select pg_temp.expect(submit_community_report('post','b2000000-0000-4000-8000-000000000021','spam','<unsafe>')->>'state'='received','anonymous report persisted');
select pg_temp.expect(submit_community_report('comment','b2000000-0000-4000-8000-000000000030','hate','')->>'state'='received','comment report persisted');
select pg_temp.expect(submit_community_report('post','b2000000-0000-4000-8000-000000000021','spam','<unsafe>')=submit_community_report('post','b2000000-0000-4000-8000-000000000021','spam','<unsafe>'),'identical receipt on retry');
select pg_temp.expect(block_community_author('post','b2000000-0000-4000-8000-000000000021')->>'state'='blocked','anonymous author block accepted');
select pg_temp.expect((select count(*)=0 from posts where id in ('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000024')),'RLS hides named anonymous and circle posts');
select pg_temp.expect((select count(*)=0 from comments where id='b2000000-0000-4000-8000-000000000030'),'anonymous comment hidden');
select pg_temp.expect((select count(*)=1 from comments where id='b2000000-0000-4000-8000-000000000031'),'other author reply survives');
select pg_temp.expect(not can_read_community_post('b2000000-0000-4000-8000-000000000020'),'direct saved post destination denied');
select pg_temp.expect((select count(*)=0 from get_trending_circle_posts() where post_id='b2000000-0000-4000-8000-000000000024'),'trending server filters blocked author');
select pg_temp.expect(list_community_blocks()->0->>'label'='Blocked dad' and not (list_community_blocks()::text like '%000000000002%'),'block list does not reveal identity');
select pg_temp.expect(block_community_author('post','b2000000-0000-4000-8000-000000000021')->>'id'=list_community_blocks()->0->>'id','duplicate block returns original');
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000003',true);
select pg_temp.expect((select count(*)=1 from posts where id='b2000000-0000-4000-8000-000000000020'),'third account unaffected');
select pg_temp.reject($q$select block_community_author('post','b2000000-0000-4000-8000-000000000023')$q$,'22023','self block denied');
select pg_temp.expect(list_community_blocks()='[]'::jsonb,'third account cannot list blocks');
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select unblock_community_author((list_community_blocks()->0->>'id')::uuid);
select pg_temp.expect((select count(*)=1 from posts where id='b2000000-0000-4000-8000-000000000020'),'unblock restores read');
reset role;
select pg_temp.expect((select count(*)=2 from community_reports),'duplicate reports did not duplicate rows');
select pg_temp.expect((select content_excerpt='anonymous' from community_reports where target_id='b2000000-0000-4000-8000-000000000021'),'report captures accessible content');
update posts set content='edited after report' where id='b2000000-0000-4000-8000-000000000021';
select pg_temp.expect((select content_excerpt='anonymous' from community_reports where target_id='b2000000-0000-4000-8000-000000000021'),'later edits do not alter evidence');
select pg_temp.reject($q$update community_reports set content_excerpt='replacement'$q$,'22023','captured excerpt is immutable');
delete from posts where id='b2000000-0000-4000-8000-000000000021';
select pg_temp.expect((select content_excerpt='anonymous' from community_reports where target_id='b2000000-0000-4000-8000-000000000021'),'source deletion does not change private report evidence');
select pg_temp.expect(not exists(select 1 from jsonb_array_elements(account_export_dataset('b2000000-0000-4000-8000-000000000001')->'sections'->'community_reports') r where r ? 'content_excerpt'),'private excerpt excluded from owner export');

select pg_temp.expect((select content_excerpt=repeat('?',500) from community_reports where target_kind='comment'),'excerpt bounded by Unicode characters');
select pg_temp.expect((select count(*)=2 from community_report_delivery where state='queued'),'durable delivery separate from report');
select pg_temp.expect(account_export_dataset('b2000000-0000-4000-8000-000000000001')->'sections'->'community_reports' @> '[{"explanation":"<unsafe>"}]','own reports in export');
select pg_temp.expect(account_export_dataset('b2000000-0000-4000-8000-000000000003')->'sections'->'community_reports'='[]'::jsonb,'other reporters not exported');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
create temp table claim as select claim_community_report_delivery() as value;
select pg_temp.expect((select value is not null from claim),'worker claims persisted report');
select pg_temp.expect(not finish_community_report_delivery((select (value->>'id')::uuid from claim),gen_random_uuid(),'fake'),'stale lease cannot acknowledge');
select pg_temp.expect(finish_community_report_delivery((select (value->>'id')::uuid from claim),(select (value->>'lease')::uuid from claim),null),'email failure recorded for recovery');
reset role;
select pg_temp.expect((select state='queued' and attempts=1 and failure_code='provider_unconfirmed' from community_report_delivery where report_id=(select (value->>'id')::uuid from claim)),'failure remains durable and unsent');
update community_report_delivery set next_attempt_at=now()-interval '1 minute';
set local role service_role;
update claim set value=claim_community_report_delivery();
select pg_temp.expect(finish_community_report_delivery((select (value->>'id')::uuid from claim),(select (value->>'lease')::uuid from claim),'fixture-provider-id'),'recovery acknowledges provider acceptance');
select pg_temp.expect(purge_resolved_community_reports()=0,'unresolved reports are not purged');
select pg_temp.reject($q$select hold_community_report((select (value->>'id')::uuid from claim),'   ')$q$,'22023','retention hold requires a reason');
reset role;
update community_reports set resolved_at=now()-interval '89 days';
set local role service_role;
select pg_temp.expect(purge_resolved_community_reports()=0,'reports younger than 90 days remain');
reset role;
update community_reports set resolved_at=now()-interval '91 days';
set local role service_role;
select hold_community_report((select (value->>'id')::uuid from claim),'Ongoing fixture issue');
select pg_temp.expect(purge_resolved_community_reports()=1,'90-day cleanup preserves authorised hold');
select hold_community_report((select (value->>'id')::uuid from claim),null);
select pg_temp.expect(purge_resolved_community_reports()=1,'hold release uses original resolution date');
reset role;
select pg_temp.expect((select count(*)=0 from community_report_delivery),'retention cascades delivery metadata');
-- Rate boundaries without generating production reports.
insert into community_reports(user_id,target_kind,target_id,reason,content_excerpt,created_at)
select 'b2000000-0000-4000-8000-000000000001','post',gen_random_uuid(),'spam','fixture',clock_timestamp() from generate_series(1,10);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reject($q$select submit_community_report('post','b2000000-0000-4000-8000-000000000020','spam','')$q$,'P0001','10 per hour cap');
reset role;
delete from community_reports;
insert into community_reports(user_id,target_kind,target_id,reason,content_excerpt,created_at)
select 'b2000000-0000-4000-8000-000000000001','post',gen_random_uuid(),'spam','fixture',now()-interval '2 hours' from generate_series(1,10);
insert into community_reports(user_id,target_kind,target_id,reason,content_excerpt,created_at)
select 'b2000000-0000-4000-8000-000000000001','post',gen_random_uuid(),'spam','fixture',now()-interval '2 hours' from generate_series(1,40);
set local role authenticated;
select pg_temp.reject($q$select submit_community_report('post','b2000000-0000-4000-8000-000000000020','spam','')$q$,'P0001','50 per rolling day cap');
reset role;
-- Phase 1 barriers and cascade coverage for the newly introduced tables.
select set_config('request.jwt.claim.role','service_role',true);
select confirm_account_privacy_operation('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000090','delete',repeat('c',64),null,now()+interval '5 minutes');
select request_account_privacy_operation('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000090','delete',repeat('c',64),repeat('d',64));
set local role authenticated;
select pg_temp.reject($q$select submit_community_report('post','b2000000-0000-4000-8000-000000000020','spam','')$q$,'42501','pending deletion rejects reports');
select pg_temp.reject($q$select block_community_author('post','b2000000-0000-4000-8000-000000000020')$q$,'42501','pending deletion rejects blocks');
reset role;
delete from auth.users where id='b2000000-0000-4000-8000-000000000001';
select pg_temp.expect((select count(*)=0 from community_reports where user_id='b2000000-0000-4000-8000-000000000001'),'Auth deletion removes reporter-owned records');
select pg_temp.expect((select count(*)=0 from community_blocks where user_id='b2000000-0000-4000-8000-000000000001'),'Auth deletion removes owner blocks');
select pg_temp.expect((select count(*)=1 from comments where id='b2000000-0000-4000-8000-000000000031'),'unrelated reply remains after reporter deletion');
rollback;
