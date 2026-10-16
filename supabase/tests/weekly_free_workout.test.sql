begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'weekly-free@example.test', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'weekly-pro@example.test', '', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'weekly-trial@example.test', '', now(), now(), now());

update public.user_profile set is_pro = true where user_id = '71000000-0000-4000-8000-000000000002';
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

select is(
  (select count(*)::integer from public.free_weekly_workout_assignments where week_start = date_trunc('week', current_date::timestamp)::date),
  1,
  'one assignment exists per Monday week'
);
select is(
  (public.admin_set_free_weekly_workout(date_trunc('week', current_date::timestamp)::date, '72000000-0000-4000-8000-000000000001')).workout_id,
  '72000000-0000-4000-8000-000000000001'::uuid,
  'Admin can set assignment through service role function'
);
select throws_ok(
  $$select public.admin_set_free_weekly_workout(date_trunc('week', current_date::timestamp)::date + 1, '72000000-0000-4000-8000-000000000001')$$,
  '22023', 'Week start must be a Monday.', 'Admin schedule rejects non-Monday dates'
);
select throws_ok(
  $$select public.admin_set_free_weekly_workout(date_trunc('week', current_date::timestamp)::date - 7, '72000000-0000-4000-8000-000000000001')$$,
  '22023', 'Past weeks cannot be rescheduled.', 'Admin schedule preserves closed weeks'
);

delete from public.free_weekly_workout_assignments
where week_start = date_trunc('week', current_date::timestamp)::date;
set local role anon;
select is((select count(*)::integer from public.free_weekly_workout_assignments), 0, 'no assignment produces explicit empty database result');
select is((select count(*)::integer from public.workouts where source = 'admin'), 0, 'no assignment exposes no arbitrary Admin workout');
reset role;
insert into public.free_weekly_workout_assignments (week_start, workout_id)
values (date_trunc('week', current_date::timestamp)::date, '72000000-0000-4000-8000-000000000001');

set local role anon;
select is((select count(*)::integer from public.free_weekly_workout_assignments), 1, 'anonymous user sees only current assignment');
select is((select count(*)::integer from public.workouts where source = 'admin'), 1, 'anonymous user sees only assigned Admin workout');
reset role;

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select ok(not public.current_user_has_pro_workout_access(), 'Free user fails canonical Pro resolver');
select is((select count(*)::integer from public.workouts where source = 'admin'), 1, 'Free user sees assigned workout only');
select is((select count(*)::integer from public.workouts where id = '72000000-0000-4000-8000-000000000003'), 1, 'Free user retains own previously generated workout');
select is((select count(*)::integer from public.workouts where id = '72000000-0000-4000-8000-000000000002'), 0, 'next week workout stays hidden before rollover');
select is((select count(*)::integer from public.workouts where id = '72000000-0000-4000-8000-000000000004'), 0, 'unassigned Admin workout stays hidden from Free user');
select is((select count(*)::integer from public.workouts where id = '72000000-0000-4000-8000-000000000005'), 0, 'other users generated workouts stay private');
reset role;

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select ok(public.current_user_has_pro_workout_access(), 'Pro user passes canonical resolver');
select is((select count(*)::integer from public.workouts where source = 'admin'), 3, 'Pro user sees full Admin library');
reset role;

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select ok(public.current_user_has_pro_workout_access(), 'Trial user passes canonical resolver');
select is((select count(*)::integer from public.workouts where source = 'admin'), 3, 'Trial user sees full Admin library');
reset role;

select ok(not has_table_privilege('anon', 'public.free_weekly_workout_assignments', 'INSERT'), 'anonymous clients cannot assign workouts');
select ok(not has_table_privilege('authenticated', 'public.free_weekly_workout_assignments', 'INSERT'), 'authenticated clients cannot assign workouts');
select ok(not has_table_privilege('authenticated', 'public.free_weekly_workout_assignments', 'UPDATE'), 'authenticated clients cannot replace assignments');
select ok(not has_function_privilege('authenticated', 'public.admin_set_free_weekly_workout(date,uuid)', 'EXECUTE'), 'clients cannot execute Admin scheduling function');
select ok(has_function_privilege('service_role', 'public.admin_set_free_weekly_workout(date,uuid)', 'EXECUTE'), 'Admin API service role can schedule assignments');

select * from finish();
rollback;
