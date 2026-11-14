begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'weekly-free@example.test', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'weekly-pro@example.test', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'weekly-trial@example.test', '', now(), now(), now());

update public.user_profile set manual_pro_grant = true where user_id = '71000000-0000-4000-8000-000000000002';
insert into public.subscription_entitlements (user_id, provider, provider_subscription_id, status, current_period_end)
values ('71000000-0000-4000-8000-000000000003', 'apple', 'weekly-workout-trial', 'trialing', now() + interval '7 days');

insert into public.workouts (id, user_id, title, duration_mins, equipment, focus, exercises, source)
values
  ('72000000-0000-4000-8000-000000000001', null, 'Assigned This Week', 10, 'none', 'full_body', '[]', 'admin'),
  ('72000000-0000-4000-8000-000000000002', null, 'Assigned Next Week', 20, 'dumbbells', 'upper', '[]', 'admin'),
  ('72000000-0000-4000-8000-000000000004', null, 'Unassigned Workout', 30, 'full_gym', 'lower', '[]', 'admin'),
  ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', 'Previously Generated', 10, 'none', 'core', '[]', 'ai_generated'),
  ('72000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000002', 'Other Dad Generated', 10, 'none', 'core', '[]', 'ai_generated');

insert into public.free_weekly_workout_assignments (week_start, workout_id)
values
  (date_trunc('week', current_date::timestamp)::date, '72000000-0000-4000-8000-000000000001'),
  (date_trunc('week', current_date::timestamp)::date + 7, '72000000-0000-4000-8000-000000000002');


select is((select access_level from public.workouts where id='72000000-0000-4000-8000-000000000004'), 'pro', 'existing insert defaults to Pro');
update public.workouts set access_level='free' where id='72000000-0000-4000-8000-000000000004';
select throws_ok($$update public.workouts set access_level='free' where id='72000000-0000-4000-8000-000000000003'$$, '23514', null, 'AI cannot be labelled Free');
select throws_ok($$update public.workouts set access_level='public' where id='72000000-0000-4000-8000-000000000004'$$, '23514', null, 'invalid access rejected');
set local role anon;
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000004'),0,'Free library requires authentication');
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000001'),1,'anonymous weekly access unchanged');
reset role;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000004'),1,'Free user reads explicitly Free admin workout');
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000001'),1,'Free user still reads assigned Pro workout');
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000002'),0,'unassigned Pro workout hidden');
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000003'),0,'own AI remains Pro-only');
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000005'),0,'other account AI remains private');
reset role;
delete from public.free_weekly_workout_assignments where week_start=date_trunc('week',current_date::timestamp)::date;
set local role authenticated;
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000004'),1,'Free library independent of assignment');
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000001'),0,'removed weekly assignment does not unlock Pro library');
reset role;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*)::int from public.workouts where id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000004')),3,'Pro sees Free and Pro admin workouts');
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000005'),1,'Pro retains own AI workout');
select is((select count(*)::int from public.workouts where id='72000000-0000-4000-8000-000000000003'),0,'Pro cannot read another account AI');
reset role;
select * from finish();
rollback;
