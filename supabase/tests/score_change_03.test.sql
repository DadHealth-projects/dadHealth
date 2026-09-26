begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('43000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mind-low@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'body-low@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bond-low@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'all-tie@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'body-bond-tie@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'body-done@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bond-done@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trend-up@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trend-down@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trend-neutral@example.test', '', now(), now(), now()),
  ('43000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trend-no-history@example.test', '', now(), now(), now());

insert into public.user_profile (user_id) select id from auth.users where id::text like '43000000-0000-4000-8000-00000000000%';

insert into public.mood_logs (user_id, date, mood_value, stress_level, mood_scale_version)
values
  ('43000000-0000-4000-8000-000000000001', current_date, 1, 5, 1),
  ('43000000-0000-4000-8000-000000000002', current_date, 5, 1, 1),
  ('43000000-0000-4000-8000-000000000003', current_date, 5, 1, 1),
  ('43000000-0000-4000-8000-000000000005', current_date, 5, 1, 1),
  ('43000000-0000-4000-8000-000000000006', current_date, 5, 1, 1),
  ('43000000-0000-4000-8000-000000000007', current_date, 5, 1, 1),
  ('43000000-0000-4000-8000-000000000008', current_date, 5, 1, 1),
  ('43000000-0000-4000-8000-000000000009', current_date, 1, 5, 1),
  ('43000000-0000-4000-8000-000000000010', current_date, 3, 3, 1),
  ('43000000-0000-4000-8000-000000000011', current_date, 3, 3, 1),
  ('43000000-0000-4000-8000-000000000008', date_trunc('week', current_date)::date - 1, 1, 5, 1),
  ('43000000-0000-4000-8000-000000000009', date_trunc('week', current_date)::date - 1, 5, 1, 1),
  ('43000000-0000-4000-8000-000000000010', date_trunc('week', current_date)::date - 1, 3, 3, 1);

insert into public.workout_sessions (user_id, exercise_name, duration_minutes, calories, performed_at)
select ids.user_id, 'Test activity', 20, 0, date_trunc('day', now()) + (n * interval '1 minute')
from (values
  ('43000000-0000-4000-8000-000000000001'::uuid, 5),
  ('43000000-0000-4000-8000-000000000003'::uuid, 5),
  ('43000000-0000-4000-8000-000000000007'::uuid, 5)
) ids(user_id, count_rows)
cross join lateral generate_series(1, ids.count_rows) n;

insert into public.journal_entries (user_id, content, mood_value, created_at)
values
  ('43000000-0000-4000-8000-000000000001', 'test', 1, now()),
  ('43000000-0000-4000-8000-000000000001', 'test', 1, now()),
  ('43000000-0000-4000-8000-000000000002', 'test', 1, now()),
  ('43000000-0000-4000-8000-000000000006', 'test', 1, now());

insert into public.bond_logs (user_id, activity_type, quality, created_at)
values ('43000000-0000-4000-8000-000000000007', 'test', 1, now());

select is((select weakest_pillar from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000001'), 'mind', 'Mind can be the canonical weakest pillar');
select is((select weakest_pillar from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000002'), 'body', 'Body can be the canonical weakest pillar');
select is((select weakest_pillar from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000003'), 'bond', 'Bond can be the canonical weakest pillar');
select is((select recommended_action from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000001'), 'mind_breathing', 'Mind lowest maps to its documented action after check-in');
select is((select recommended_action from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000002'), 'body_workout', 'Body lowest maps to a workout when no workout was logged today');
select is((select recommended_action from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000003'), 'bond_present_mode', 'Bond lowest maps to Present Dad when no Bond action was logged today');
select is((select weakest_pillar from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000004'), 'mind', 'an all-pillar tie deterministically favors Mind');
select is((select weakest_pillar from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000005'), 'body', 'a Body-Bond tie deterministically favors Body');
select is((select recommended_action from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000006'), 'body_workout', 'Body is recommended before its activity is completed');

insert into public.workout_sessions (user_id, exercise_name, duration_minutes, calories, performed_at)
values ('43000000-0000-4000-8000-000000000006', 'Test activity', 20, 0, now());

select is((select recommended_action from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000006'), 'bond_present_mode', 'a completed workout is excluded and the next available action is selected');
select is((select recommended_action from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000007'), 'body_workout', 'a completed Bond action is excluded from the recommendation');
select ok(not (select mind_has_data or body_has_data or bond_has_data from public.dad_score_history_view where user_id = '43000000-0000-4000-8000-000000000004' and week_start = date_trunc('week', current_date)::date), 'history exposes an empty current week as unavailable');
select ok((select mind_has_data from public.dad_score_history_view where user_id = '43000000-0000-4000-8000-000000000001' and week_start = date_trunc('week', current_date)::date), 'history exposes a logged Mind week as available');
select is((select recommended_action from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000004'), 'checkin', 'check-in remains the first action before any other recommendation');
select is((select mind_week_change from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000008'), 100::numeric, 'canonical Mind trend reports a positive week-on-week change');
select is((select mind_week_change from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000009'), (-100)::numeric, 'canonical Mind trend reports a negative week-on-week change');
select is((select mind_week_change from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000010'), 0::numeric, 'canonical Mind trend reports a neutral unchanged score');
select is((select mind_week_change from public.dad_score_view where user_id = '43000000-0000-4000-8000-000000000011'), null::numeric, 'canonical trend stays null without previous-week data');

select * from finish();
rollback;
