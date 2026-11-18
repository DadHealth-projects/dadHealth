-- Disposable local database only. Repository tables/calendar/entitlement functions.
-- All fixtures and the test-only operation clock are rolled back.
begin;
create extension if not exists pgtap;
select no_plan();
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values
 ('04000000-0000-4000-8000-000000000001','mind-manual@example.invalid'),
 ('04000000-0000-4000-8000-000000000002','mind-free@example.invalid'),
 ('04000000-0000-4000-8000-000000000003','mind-paid@example.invalid'),
 ('04000000-0000-4000-8000-000000000004','mind-trial@example.invalid');
update public.user_profile set manual_pro_grant=true where user_id='04000000-0000-4000-8000-000000000001';
update public.user_profile set goals='["I want to be more present"]' where user_id='04000000-0000-4000-8000-000000000004';
update public.user_profile set goals='["I''m struggling and not saying so"]' where user_id='04000000-0000-4000-8000-000000000003';
insert into public.subscription_entitlements(user_id,provider,provider_subscription_id,status,current_period_end)
values ('04000000-0000-4000-8000-000000000003','apple','item04-paid','active','2099-01-01Z'),
 ('04000000-0000-4000-8000-000000000004','apple','item04-trial','trialing','2099-01-01Z');
delete from public.scoring_timezone_history where user_id::text like '04000000-%';
insert into public.scoring_timezone_history
select id,'-infinity','-infinity','Europe/London' from auth.users where id::text like '04000000-%';

create function pg_temp.clock(at_time timestamptz) returns void language plpgsql as $$
declare definition text; begin
 definition:=pg_get_functiondef('public.mind_plan_operation(uuid,text,uuid,integer)'::regprocedure);
 definition:=regexp_replace(definition,'(''[^'']+''::timestamptz /\* mind test clock \*/|clock_timestamp\(\))',
  quote_literal(at_time)||'::timestamptz /* mind test clock */','g');
 execute definition;
end $$;
create function pg_temp.op(operation text,action integer default null) returns jsonb language sql as $$
 select public.mind_plan_operation('04000000-0000-4000-8000-000000000001',operation,
 case when operation='complete' then (select id from public.mind_plans where user_id='04000000-0000-4000-8000-000000000001') else null end,action);
$$;
select pg_temp.clock('2026-03-28 23:59:00Z');
select is(pg_temp.op('read')->>'state','not_started','GET does not create');
select is((select count(*) from public.mind_plans where user_id='04000000-0000-4000-8000-000000000001'),0::bigint,'no plan written by GET');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000002','start')->>'state','locked','Free denied');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000003','start')->>'state','available','paid Pro supported');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000004','start')->>'state','available','eligible trial supported');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000004','read')->'plan'->'actions'->0->>'route','Journal','presence goal selects Journal first');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000003','read')->'plan'->>'variant','gentle','explicit goal selects gentle variant');
create temp table original_plan as select pg_temp.op('start') result;
select is((select result->>'state' from original_plan),'available','manual Pro supported');
select is(pg_temp.op('start')->'plan',(select result->'plan' from original_plan),'start retry returns same immutable plan');
select is(pg_temp.op('read')->'plan'->>'startedOn','2026-03-28','starts immediately on Saturday, not Monday');
select is(pg_temp.op('read')->'plan'->>'canComplete','true','Day 1 immediately available');
select is(jsonb_array_length(pg_temp.op('read')->'plan'->'actions'),7,'seven actions stored');
select is(pg_temp.op('read')->'plan'->>'copyStatus','draft','copy explicitly draft');
select is(pg_temp.op('complete',2)->>'reason','action_out_of_order','cannot skip action');
create temp table first_receipt as select pg_temp.op('complete',1)->'receipt' receipt;
select is(pg_temp.op('complete',1)->'receipt',(select receipt from first_receipt),'completion replay returns identical receipt');
select is(pg_temp.op('complete',2)->>'reason','daily_limit','second completion on same local day blocked');
select is((select count(*) from public.mind_plan_completions where user_id='04000000-0000-4000-8000-000000000001'),1::bigint,'duplicate never advances twice');
select pg_temp.clock('2026-03-29 00:00:00Z');
select is(pg_temp.op('complete',2)->>'state','available','next local midnight unlocks');
select pg_temp.clock('2026-03-29 22:59:00Z');
select is(pg_temp.op('complete',3)->>'reason','daily_limit','BST before next midnight stays locked');
select pg_temp.clock('2026-03-29 23:00:00Z');
select is(pg_temp.op('complete',3)->'receipt'->>'completedOn','2026-03-30','23-hour DST day advances by calendar date');
select pg_temp.clock('2026-04-10 12:00:00Z');
select is(pg_temp.op('read')->'plan'->>'nextAction','4','missed days keep pending action');
update public.user_profile set manual_pro_grant=false where user_id='04000000-0000-4000-8000-000000000001';
select is(pg_temp.op('read')->>'state','locked','expiry removes restricted reads');
select is(pg_temp.op('complete',4)->>'state','locked','expiry blocks completion');
select is((select count(*) from public.mind_plans where user_id='04000000-0000-4000-8000-000000000001'),1::bigint,'expiry preserves plan');
update public.user_profile set manual_pro_grant=true where user_id='04000000-0000-4000-8000-000000000001';
select is(pg_temp.op('read')->'plan'->>'canComplete','true','resubscription resumes immediately on eligible date');
select is(pg_temp.op('complete',4)->>'state','available','resumed pending action completes');
select is(pg_temp.op('start')->'plan'->>'nextAction','5','start never restarts for extra actions');
select is(pg_temp.op('complete',5)->>'reason','daily_limit','resubscription preserves daily cap');

-- Canonical history takes effect at its recorded instant. Date regressions cannot
-- double count a date, and future timezone entries are not used prematurely.
insert into public.scoring_timezone_history values
 ('04000000-0000-4000-8000-000000000001','2026-04-13','2026-04-13 07:00Z','America/Los_Angeles');
select pg_temp.clock('2026-04-13 06:30Z');
select is(pg_temp.op('read')->>'currentDate','2026-04-12','canonical westward overlap remains Sunday');
select is(pg_temp.op('read')->>'timezone','Europe/London','scheduled zone not effective early');
select pg_temp.clock('2026-04-13 07:00Z');
select is(pg_temp.op('read')->>'timezone','America/Los_Angeles','effective timezone applied');
select is(pg_temp.op('complete',5)->'receipt'->>'completedOn','2026-04-13','completion records new account-local date');
select pg_temp.clock('2026-04-12 12:00Z');
select is(pg_temp.op('complete',6)->>'reason','daily_limit','backward date cannot advance');
select pg_temp.clock('2026-10-25 07:00Z');
select is(pg_temp.op('complete',6)->>'state','available','pending action survives long gap');
select pg_temp.clock('2026-10-26 07:00Z');
select is(pg_temp.op('complete',7)->'plan'->>'completed','true','seventh completion closes plan');
select is(pg_temp.op('read')->'plan'->>'nextAction',null,'completed plan has no next action');
select is(jsonb_array_length(pg_temp.op('read')->'plan'->'completions'),7,'all completion history reviewable');
select is(pg_temp.op('start')->'plan'->>'id',(select result->'plan'->>'id' from original_plan),'no automatic new cycle');
select is(pg_temp.op('complete',1)->'receipt',(select receipt from first_receipt),'old completion retries retain original receipt');
update public.user_profile set goals='["I want to be more present"]' where user_id='04000000-0000-4000-8000-000000000001';
create or replace function public.mind_plan_actions_v1(p_variant text) returns jsonb language sql immutable set search_path=pg_catalog,public as $$ select '[]'::jsonb $$;
select is(pg_temp.op('read')->'plan'->'actions',(select result->'plan'->'actions' from original_plan),'saved actions survive profile/catalogue changes');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000003','complete',
 (select result->'plan'->>'id' from original_plan)::uuid,1)->>'reason','plan_mismatch','foreign plan ID rejected');
update public.subscription_entitlements set current_period_end='2000-01-01Z' where provider_subscription_id='item04-trial';
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000004','read')->>'state','locked','expired trial cannot read');
select pg_temp.clock('2026-10-24 23:30Z');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000003','complete',
 (select id from public.mind_plans where user_id='04000000-0000-4000-8000-000000000003'),1)->'receipt'->>'completedOn','2026-10-25','autumn BST date is account-local');
select pg_temp.clock('2026-10-25 23:59Z');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000003','complete',
 (select id from public.mind_plans where user_id='04000000-0000-4000-8000-000000000003'),2)->>'reason','daily_limit','25-hour local day stays locked until midnight');
select pg_temp.clock('2026-10-26 00:00Z');
select is(public.mind_plan_operation('04000000-0000-4000-8000-000000000003','complete',
 (select id from public.mind_plans where user_id='04000000-0000-4000-8000-000000000003'),2)->>'state','available','GMT midnight unlocks next action');

select ok(not has_table_privilege('authenticated','public.mind_plans','select'),'direct restricted reads denied');
select ok(not has_table_privilege('anon','public.mind_plan_completions','select'),'anonymous history reads denied');
select ok(not has_table_privilege('authenticated','public.mind_plans','insert'),'client cannot create own or foreign plan');
select ok(not has_table_privilege('service_role','public.mind_plans','update'),'service cannot rewrite stored content directly');
select ok(not has_function_privilege('authenticated','public.mind_plan_operation(uuid,text,uuid,integer)','execute'),'clients cannot supply arbitrary RPC owner');
select ok(not has_function_privilege('anon','public.mind_plan_operation(uuid,text,uuid,integer)','execute'),'anonymous RPC denied');
select ok(not has_function_privilege('service_role','public.mind_plan_actions_v1(text)','execute'),'private catalogue cannot bypass restricted reads');
set local role authenticated;
select throws_ok('select * from public.mind_plans','42501',null,'actual authenticated SELECT denied');
select throws_ok($$select public.mind_plan_operation('04000000-0000-4000-8000-000000000001','read')$$,'42501',null,'actual client RPC denied');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.mind_plan_operation('04000000-0000-4000-8000-000000000001','read')$$,'42501',null,'function also validates trusted caller role');
select set_config('request.jwt.claim.role','service_role',true);
create or replace function public.user_has_pro_access(p_user_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select null::boolean $$;
select is(pg_temp.op('read')->>'state','unavailable','null entitlement fails unavailable, not Free');
create or replace function public.user_has_pro_access(p_user_id uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$ begin raise exception 'test unavailable'; end $$;
select throws_ok($$select pg_temp.op('read')$$,'P0001','test unavailable','entitlement failure aborts for API unavailable handling');
select * from finish();
rollback;
