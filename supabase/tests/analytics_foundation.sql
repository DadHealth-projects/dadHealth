-- Run only in the disposable fixture database created by analyticsDatabase.test.mjs.
select set_config('request.jwt.claim.role','service_role',false);
create function pg_temp.assert(ok boolean,label text) returns text language plpgsql as $$begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if; return 'PASS: '||label; end$$;
select pg_temp.assert(not has_table_privilege('anon','public.analytics_outbox','SELECT'),'anonymous has no raw event access');
select pg_temp.assert(not has_table_privilege('authenticated','public.analytics_consents','SELECT'),'client cannot read consent capabilities');
select pg_temp.assert(not has_table_privilege('authenticated','public.analytics_outbox','INSERT'),'no client event writes');
select pg_temp.assert(not has_function_privilege('authenticated','public.claim_optional_analytics()','EXECUTE'),'worker RPC is private');
select pg_temp.assert(has_function_privilege('service_role','public.claim_optional_analytics()','EXECUTE'),'trusted worker RPC granted');
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111');
insert into analytics_consents(id,user_id,secret_hash,distinct_id) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',repeat('a',64),'11111111-1111-4111-8111-111111111111');
insert into analytics_consents(id,secret_hash,distinct_id) values('44444444-4444-4444-8444-444444444444',repeat('c',64),'anonymous-fixture');
create function pg_temp.event(id uuid,at_time timestamptz default clock_timestamp()) returns jsonb language sql as $$
 select jsonb_build_object('version',1,'id',id,'event','app_opened','timestamp',at_time,'properties','{}'::jsonb);
$$;
select pg_temp.assert(public.ingest_optional_analytics('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('a',64),pg_temp.event('33333333-3333-4333-8333-333333333333'))='accepted','durable ingestion');
select pg_temp.assert(public.ingest_optional_analytics('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('a',64),pg_temp.event('33333333-3333-4333-8333-333333333333',(select occurred_at from analytics_outbox)))='accepted','identical retry returns receipt');
select pg_temp.assert((select count(*)=1 from analytics_outbox),'one event after retry');
select pg_temp.assert(public.ingest_optional_analytics('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('b',64),pg_temp.event(gen_random_uuid()))='conflict','forged consent secret rejected');
select pg_temp.assert(public.account_export_dataset('11111111-1111-4111-8111-111111111111')->'sections'->'optionalAnalytics'->0->>'event'='app_opened','same immutable export includes analytics');
select pg_temp.assert(public.account_export_dataset('11111111-1111-4111-8111-111111111111')->'sections'->'fixture'->0->'nullable'='null'::jsonb,'wrapper preserves predecessor null values');
select pg_temp.assert(public.account_export_dataset('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'sections'->'optionalAnalytics'='[]'::jsonb,'export excludes other owner events');
select pg_temp.assert(jsonb_array_length(public.account_export_dataset('11111111-1111-4111-8111-111111111111')->'sections'->'optionalAnalyticsConsent')=1
 and not (public.account_export_dataset('11111111-1111-4111-8111-111111111111')->'sections'->'optionalAnalyticsConsent'->0 ? 'secret_hash'),'consent history exported without capabilities');
create temp table leased as select * from public.claim_optional_analytics();
select pg_temp.assert(public.authorize_optional_analytics((select id from leased),(select lease from leased)),'current consent authorizes HTTP');
select pg_temp.assert((select count(*)=1 from leased),'worker claims one event');
select pg_temp.assert(not exists(select * from public.claim_optional_analytics()),'overlapping worker cannot claim lease');
select pg_temp.assert(not public.finish_optional_analytics((select id from leased),gen_random_uuid(),'sent'),'stale worker cannot confirm');
insert into public.account_deletion_tombstones(user_id) values('11111111-1111-4111-8111-111111111111');
select pg_temp.assert(not public.authorize_optional_analytics((select id from leased),(select lease from leased)),'deletion revokes a previously claimed HTTP attempt');
select pg_temp.assert(not public.purge_deleted_analytics('11111111-1111-4111-8111-111111111111'),'deletion waits for in-flight delivery');
select pg_temp.assert(public.ingest_optional_analytics('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('a',64),pg_temp.event(gen_random_uuid()))='removed','deleted owner cannot enqueue');
select public.finish_optional_analytics((select id from leased),(select lease from leased),'sent');
select pg_temp.assert(public.purge_deleted_analytics('11111111-1111-4111-8111-111111111111'),'drained deletion purges local analytics');
select pg_temp.assert(not exists(select 1 from analytics_outbox),'owner rows erased');
select public.ingest_optional_analytics(null,'44444444-4444-4444-8444-444444444444',repeat('c',64),null,true);
select pg_temp.assert(public.ingest_optional_analytics(null,'44444444-4444-4444-8444-444444444444',repeat('c',64),pg_temp.event(gen_random_uuid()))='revoked','withdraw before upload prevents late ingestion');
select pg_temp.assert(public.ingest_optional_analytics(null,gen_random_uuid(),repeat('c',64),pg_temp.event(gen_random_uuid(),clock_timestamp()-interval '8 days'))='expired','unknown capability replay rejected');
insert into analytics_consents(id,secret_hash,distinct_id) values('55555555-5555-4555-8555-555555555555',repeat('d',64),'anonymous-fixture');
insert into analytics_outbox(id,consent_id,distinct_id,event,occurred_at,properties,created_at,state)
 values(gen_random_uuid(),'55555555-5555-4555-8555-555555555555','anonymous-fixture','app_opened',now()-interval '8 days','{}',now()-interval '8 days','pending'),
 (gen_random_uuid(),'55555555-5555-4555-8555-555555555555','anonymous-fixture','app_opened',now()-interval '31 days','{}',now()-interval '31 days','sent');
select public.cleanup_optional_analytics();
select pg_temp.assert(not exists(select 1 from analytics_outbox),'7-day pending and 30-day receipts expire');
select public.analytics_rate_limit(repeat('e',64)) from generate_series(1,60);
select pg_temp.assert(not public.analytics_rate_limit(repeat('e',64)),'rate limit enforced durably');
