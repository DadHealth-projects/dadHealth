-- ISOLATED LOCAL DATABASE ONLY. Synthetic fixtures; rollback all changes.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
values ('77000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase2@example.test','',now(),now());
insert into public.user_profile(user_id,timezone) values ('77000000-0000-4000-8000-000000000001','UTC') on conflict(user_id) do nothing;
update public.activity_score_config set effective_week_start='2019-12-16';
update public.dad_score_model_config set effective_week_start='2019-12-23' where model_version='60_40_10_30_v1';
update public.mind_score_model_config set effective_week_start='2020-01-06';
create function pg_temp.score() returns numeric language sql as $$
  select mind_score from public.calculate_dad_score_period('77000000-0000-4000-8000-000000000001','2020-01-06','2020-01-13','2020-01-06T00:00:00Z','2020-01-13T00:00:00Z');
$$;
-- Incremental 1..7 days and repeated updates cannot add participation credit.
do $$ begin
  for d in 0..6 loop
    insert into public.mood_logs(user_id,date,mood_value,stress_level,mood_scale_version)
    values ('77000000-0000-4000-8000-000000000001','2020-01-06'::date+d,1,5,1);
    if pg_temp.score() <> (d+1)*10 then raise exception 'participation day % failed',d+1; end if;
  end loop;
end $$;
select is(pg_temp.score(),70::numeric,'seven difficult-answer check-ins earn 70');
update public.mood_logs set mood_value=5,stress_level=1 where user_id='77000000-0000-4000-8000-000000000001';
select is(pg_temp.score(),70::numeric,'answer edits and positive answers do not change participation');
insert into public.journal_entries(user_id,content,mood_value,created_at)
select '77000000-0000-4000-8000-000000000001','synthetic fixture',1,'2020-01-06T12:00:00Z'::timestamptz+d*interval '1 day' from generate_series(0,4) d;
select is(round(pg_temp.score(),2),91.43::numeric,'five ordinary activity days exceed 90');
insert into public.journal_entries(user_id,content,mood_value,created_at)
select '77000000-0000-4000-8000-000000000001','synthetic fixture',1,'2020-01-11T12:00:00Z'::timestamptz+d*interval '1 day' from generate_series(0,1) d;
select is(pg_temp.score(),100::numeric,'seven ordinary journal days reach 100');
update public.journal_entries set content='edited synthetic fixture',created_at='2020-01-20T00:00:00Z' where user_id='77000000-0000-4000-8000-000000000001';
select is(pg_temp.score(),100::numeric,'edits preserve date and cannot earn more credit');
select set_config('request.jwt.claims','{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.complete_mind_reset('77000000-0000-4000-8000-000000000011','2020-01-06T12:00:00Z',60);
select public.complete_mind_reset('77000000-0000-4000-8000-000000000011','2020-01-06T12:00:00Z',60);
select is((select count(*) from public.mind_reset_sessions where id='77000000-0000-4000-8000-000000000011'),1::bigint,'reset retries persist one session');
select is(pg_temp.score(),100::numeric,'reset and journal on same day share one winner');
select throws_ok($$select public.complete_mind_reset('77000000-0000-4000-8000-000000000012','2020-01-06T12:00:00Z',59)$$,'22023','invalid_mind_reset','short reset rejected');
select set_config('request.jwt.claims','{"sub":"77000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.complete_mind_reset('77000000-0000-4000-8000-000000000011','2020-01-06T12:00:00Z',60)$$,'42501','mind_reset_owner_mismatch','another owner cannot claim reset');
select set_config('request.jwt.claims','{}',true);
delete from public.journal_entries where user_id='77000000-0000-4000-8000-000000000001';
select is(round(pg_temp.score(),2),74.29::numeric,'deletion removes journal credit; reset still counts');
-- Only this isolated fixture bypasses the existing seven-day input limit.
alter table public.activity_logs disable trigger activity_logs_validate_insert;
insert into public.activity_logs(user_id,client_request_id,pillar,category,activity_type,duration_minutes,activity_date)
values ('77000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000021','mind','professional_support','therapy',5,'2020-01-06');
alter table public.activity_logs enable trigger activity_logs_validate_insert;
select is(round(pg_temp.score(),2),78.57::numeric,'manual eight beats automatic four; never adds both');
select results_eq(
  $$select * from public.calculate_dad_score_period('77000000-0000-4000-8000-000000000001','2019-12-30','2020-01-06','2019-12-30T00:00:00Z','2020-01-06T00:00:00Z')$$,
  $$select * from public.calculate_dad_score_period_pre_phase2('77000000-0000-4000-8000-000000000001','2019-12-30','2020-01-06','2019-12-30T00:00:00Z','2020-01-06T00:00:00Z')$$,
  'historical week delegates unchanged');
select results_eq(
  $$select body_score,bond_score from public.calculate_dad_score_period('77000000-0000-4000-8000-000000000001','2020-01-06','2020-01-13','2020-01-06T00:00:00Z','2020-01-13T00:00:00Z')$$,
  $$select body_score,bond_score from public.calculate_dad_score_period_pre_phase2('77000000-0000-4000-8000-000000000001','2020-01-06','2020-01-13','2020-01-06T00:00:00Z','2020-01-13T00:00:00Z')$$,
  'Body and Bond formulas retained');
insert into public.scoring_timezone_history values
 ('77000000-0000-4000-8000-000000000001','2026-03-02','2026-03-02T00:00:00Z','Europe/London'),
 ('77000000-0000-4000-8000-000000000001','2026-11-16','2026-11-16T05:00:00Z','America/New_York');
select is(public.scoring_week_boundary('77000000-0000-4000-8000-000000000001','2026-03-30'),'2026-03-29T23:00:00Z'::timestamptz,'London spring DST boundary');
select is(public.scoring_week_boundary('77000000-0000-4000-8000-000000000001','2026-10-26'),'2026-10-26T00:00:00Z'::timestamptz,'London autumn DST boundary');
select is(public.scoring_date_at('77000000-0000-4000-8000-000000000001','2026-11-16T04:59:00Z'),'2026-11-15'::date,'westward transition waits for new Monday');
select is(public.scoring_date_at('77000000-0000-4000-8000-000000000001','2026-11-16T05:00:00Z'),'2026-11-16'::date,'new Monday activates once');
select ok(not has_table_privilege('authenticated','public.mind_reset_sessions','INSERT'),'reset direct inserts denied');
select ok(not has_table_privilege('authenticated','public.scoring_timezone_history','UPDATE'),'timezone history cannot be rewritten by client');
select ok(not has_function_privilege('anon','public.complete_mind_reset(uuid,timestamptz,integer)','EXECUTE'),'anonymous reset RPC denied');
select ok(not has_function_privilege('authenticated','public.calculate_dad_score_period_pre_phase2(uuid,date,date,timestamptz,timestamptz)','EXECUTE'),'legacy implementation is internal only');
select set_config('request.jwt.claims','{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.mind_reset_sessions),1::bigint,'owner can read own reset under RLS');
select lives_ok($$select mind_score from public.dad_score_view where user_id='77000000-0000-4000-8000-000000000001'$$,'authenticated score view dependencies are executable');
select throws_ok($$select public.scoring_display_boundary('77000000-0000-4000-8000-000000000002','2026-11-16')$$,'42501','score_user_mismatch','display helper rejects other account');
select set_config('request.jwt.claims','{"sub":"77000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.mind_reset_sessions),0::bigint,'another account sees no reset rows');
reset role;
select set_config('request.jwt.claims','{}',true);
select * from finish();
rollback;
