begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('74000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'change07-one@example.test', '', now(), now(), now()),
  ('74000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'change07-mini@example.test', '', now(), now(), now());

insert into public.user_profile(user_id) values
  ('74000000-0000-4000-8000-000000000001'),
  ('74000000-0000-4000-8000-000000000002')
on conflict (user_id) do nothing;

-- Full seven-day manual cap and same-day highest-log selection.
insert into public.activity_logs (user_id, client_request_id, pillar, activity_type, duration_minutes, intensity, activity_date)
select '74000000-0000-4000-8000-000000000001', gen_random_uuid(), 'body', 'running', 60, 'hard', d::date
from generate_series((now() at time zone 'UTC')::date - 6, (now() at time zone 'UTC')::date, interval '1 day') d;
insert into public.activity_logs (user_id, client_request_id, pillar, activity_type, duration_minutes, intensity, activity_date)
values
  ('74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000011', 'body', 'walking', 30, 'light', (now() at time zone 'UTC')::date);

-- Mind: activity type sets points, duration only controls eligibility.
insert into public.activity_logs (user_id, client_request_id, pillar, category, activity_type, duration_minutes, activity_date)
values
  ('74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000021', 'mind', 'professional_support', 'therapy', 5, (now() at time zone 'UTC')::date),
  ('74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000022', 'mind', 'mindfulness', 'meditation', 4, (now() at time zone 'UTC')::date);

-- Bond baselines, 45-minute upgrade, remote non-contact credit and under-minimum save.
insert into public.activity_logs (user_id, client_request_id, pillar, category, activity_type, other_activity_text, duration_minutes, contact_day, activity_date)
values
  ('74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000031', 'bond', 'routine', 'bedtime_routine', null, 15, true, (now() at time zone 'UTC')::date - 1),
  ('74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000032', 'bond', 'play', 'lego', null, 44, true, (now() at time zone 'UTC')::date - 1),
  ('74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000033', 'bond', 'remote', 'facetime', null, 45, false, (now() at time zone 'UTC')::date),
  ('74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000034', 'bond', 'other', 'other', 'Family activity', 10, false, (now() at time zone 'UTC')::date - 2);

-- Under-minimum Body and Mind logs remain in history but do not score.
insert into public.activity_logs (user_id, client_request_id, pillar, activity_type, duration_minutes, intensity, activity_date)
values ('74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000041', 'body', 'yoga', 14, 'moderate', (now() at time zone 'UTC')::date - 3);

insert into public.activity_logs (user_id, client_request_id, pillar, category, activity_type, duration_minutes, contact_day, activity_date)
values
  ('74000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000051', 'bond', 'active', 'mini_partners', 90, true, (now() at time zone 'UTC')::date),
  ('74000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000052', 'bond', 'active', 'mini_partners', 10, true, (now() at time zone 'UTC')::date - 1);

-- Full non-manual Mind input scales to 30; an eligible therapy log adds 8.
insert into public.mood_logs (user_id, date, mood_value, stress_level, mood_scale_version)
select '74000000-0000-4000-8000-000000000001', d::date, 5, 1, 1
from generate_series(date_trunc('week', current_date)::date, current_date, interval '1 day') d
on conflict (user_id, date) do update set mood_value = excluded.mood_value, stress_level = excluded.stress_level, mood_scale_version = excluded.mood_scale_version;
insert into public.mood_logs (user_id, date, mood_value, stress_level, mood_scale_version)
values ('74000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 7, 5, 1, 1)
on conflict (user_id, date) do update set mood_value = excluded.mood_value, stress_level = excluded.stress_level, mood_scale_version = excluded.mood_scale_version;

select is((select body_manual_points from public.calculate_manual_activity_period(
  '74000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date - 6, (now() at time zone 'UTC')::date + 1
)), 70::numeric, 'seven daily Maximum Body logs cap at 70 points');

select is((select body_manual_points from public.calculate_manual_activity_period(
  '74000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7
)), least(70, ((current_date - date_trunc('week', current_date)::date + 1) * 10))::numeric, 'current-week Body sums daily winners');

select is((select mind_score from public.calculate_dad_score_period(
  '74000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), 38::numeric, 'existing 100-point Mind input is normalized to 30 before adding 8 manual points');

select is((select bond_manual_points from public.calculate_manual_activity_period(
  '74000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date - 6, (now() at time zone 'UTC')::date + 1
)), 12::numeric, 'Bond duration upgrade and highest same-day log are applied');

select is((select body_manual_points from public.calculate_manual_activity_period(
  '74000000-0000-4000-8000-000000000002', current_date, current_date + 1
)), 8::numeric, 'one Mini Partners row contributes Strong points to Body');

select is((select bond_manual_points from public.calculate_manual_activity_period(
  '74000000-0000-4000-8000-000000000002', current_date, current_date + 1
)), 8::numeric, 'the same Mini Partners row contributes Strong points to Bond');

select is((select bond_manual_points from public.calculate_manual_activity_period(
  '74000000-0000-4000-8000-000000000002', current_date - 1, current_date
)), 0::numeric, 'under-15-minute Mini Partners Bond activity is saved but scores zero');

select is((select count(*)::integer from public.activity_logs
  where user_id = '74000000-0000-4000-8000-000000000001' and activity_date = current_date and pillar = 'body'), 2,
  'both same-day Body logs are retained even though only one scores');

select ok((select mind_manual_has_data from public.calculate_manual_activity_period(
  '74000000-0000-4000-8000-000000000001', current_date - 1, current_date + 1
)), 'under-minimum Mind log remains represented as activity history');

select is((select count(*)::integer from public.activity_logs
  where client_request_id = '74000000-0000-4000-8000-000000000041'), 1, 'under-minimum Body log is saved');

select is((select body_score from public.calculate_dad_score_period(
  '74000000-0000-4000-8000-000000000001', current_date - 3, current_date - 2,
  (current_date - 3)::timestamptz, (current_date - 2)::timestamptz
)), 0::numeric, 'under-minimum Body activity has no score contribution');

select is((select mind_score from public.calculate_dad_score_period(
  '74000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date,
  (date_trunc('week', current_date)::date - 7)::timestamptz, date_trunc('week', current_date)::date::timestamptz
)), (select mind_score from public.calculate_dad_score_nonmanual_period(
  '74000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date,
  (date_trunc('week', current_date)::date - 7)::timestamptz, date_trunc('week', current_date)::date::timestamptz
)), 'closed historical week retains pre-Change-07 scoring semantics');

select ok(has_table_privilege('authenticated', 'public.activity_logs', 'SELECT'), 'Free authenticated users can read their own activity history');
select ok(has_table_privilege('authenticated', 'public.activity_logs', 'INSERT'), 'Free authenticated users can create manual logs');
select ok(not has_table_privilege('authenticated', 'public.activity_logs', 'UPDATE'), 'manual log records cannot be rewritten through the client');
select ok(not has_table_privilege('authenticated', 'public.dad_manual_activity_history_view', 'SELECT'), 'Free clients cannot query derived manual trends directly');
select ok(has_table_privilege('service_role', 'public.dad_manual_activity_history_view', 'SELECT'), 'Pro API service role can query derived manual trends');
select ok(not has_function_privilege('authenticated', 'public.calculate_manual_activity_period(uuid,date,date)', 'EXECUTE'), 'Free clients cannot call the manual-only score helper');

select throws_ok($$insert into public.activity_logs (user_id, client_request_id, pillar, activity_type, duration_minutes, intensity, activity_date)
  values ('74000000-0000-4000-8000-000000000001', gen_random_uuid(), 'body', 'running', 30, 'moderate', (now() at time zone 'UTC')::date + 1)$$,
  '22023', 'activity_date_cannot_be_future', 'future activity dates are rejected by the database');

select throws_ok($$insert into public.activity_logs (user_id, client_request_id, pillar, activity_type, duration_minutes, intensity, activity_date)
  values ('74000000-0000-4000-8000-000000000001', gen_random_uuid(), 'body', 'running', 30, 'moderate', (now() at time zone 'UTC')::date - 8)$$,
  '22023', 'activity_date_exceeds_backdate_limit', 'activity dates older than seven days are rejected by the database');

select * from finish();
rollback;
