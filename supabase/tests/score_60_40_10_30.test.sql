begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('76000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'score603010-one@example.test', '', now(), now(), now()),
  ('76000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'score603010-none@example.test', '', now(), now(), now()),
  ('76000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'score603010-days@example.test', '', now(), now(), now());

insert into public.user_profile(user_id) values
  ('76000000-0000-4000-8000-000000000001'),
  ('76000000-0000-4000-8000-000000000002'),
  ('76000000-0000-4000-8000-000000000003')
on conflict (user_id) do nothing;

update public.activity_score_config
set effective_week_start = date_trunc('week', current_date)::date - 14
where singleton = true;
update public.dad_score_model_config
set effective_week_start = date_trunc('week', current_date)::date - 7
where model_version = '60_40_10_30_v1';

-- Deliberately difficult answers: participation still earns full check-in credit.
insert into public.mood_logs (user_id, date, mood_value, stress_level, energy_level, connection_level, mood_scale_version)
values ('76000000-0000-4000-8000-000000000001', current_date, 1, 5, 1, 1, 1);

insert into public.activity_logs (user_id, client_request_id, pillar, category, activity_type, duration_minutes, activity_date)
values ('76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000011', 'mind', 'professional_support', 'therapy', 5, current_date);
insert into public.activity_logs (user_id, client_request_id, pillar, category, activity_type, duration_minutes, contact_day, activity_date)
values
  ('76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000012', 'bond', 'active', 'mini_partners', 15, true, current_date),
  ('76000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000021', 'bond', 'active', 'mini_partners', 15, true, current_date);

insert into public.sleep_logs (user_id, date, hours) values
  ('76000000-0000-4000-8000-000000000001', current_date, 8);
insert into public.journal_entries (user_id, content, mood_value, created_at) values
  ('76000000-0000-4000-8000-000000000001', 'Scoring regression fixture', 1, now());

-- Fill prior full week with low Mind answers; seven check-ins earn all 40 points.
insert into public.mood_logs (user_id, date, mood_value, stress_level, mood_scale_version)
values
  ('76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 1, 5, 1, 1),
  ('76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 14, 5, 1, 1),
  ('76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 21, 5, 1, 1);
insert into public.mood_logs (user_id, date, mood_value, stress_level, mood_scale_version)
select '76000000-0000-4000-8000-000000000001', d::date, 1, 5, 1
from generate_series(
  date_trunc('week', current_date)::date - 7,
  date_trunc('week', current_date)::date - 2,
  interval '1 day'
) d;
insert into public.activity_logs (user_id, client_request_id, pillar, category, activity_type, duration_minutes, activity_date)
values ('76000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000013', 'mind', 'professional_support', 'therapy', 5, date_trunc('week', current_date)::date - 1);

select is(round((select mind_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), 2), 12.57::numeric, 'one low Mind check-in earns 40/7 participation points plus proportional manual points');

-- Test weekly participation against a completed prior week, independent of today.
insert into public.mood_logs (user_id, date, mood_value, stress_level, mood_scale_version)
select '76000000-0000-4000-8000-000000000003', d::date, 1, 5, 1
from generate_series(
  date_trunc('week', current_date)::date - 7,
  date_trunc('week', current_date)::date - 5,
  interval '1 day'
) d;
select is(round((select mind_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date,
  (date_trunc('week', current_date)::date - 7)::timestamptz, date_trunc('week', current_date)::date::timestamptz
)), 2), 17.14::numeric, 'three of seven low-answer days earn exactly three-sevenths of Mind participation credit');
insert into public.mood_logs (user_id, date, mood_value, stress_level, mood_scale_version)
select '76000000-0000-4000-8000-000000000003', d::date, 1, 5, 1
from generate_series(
  date_trunc('week', current_date)::date - 4,
  date_trunc('week', current_date)::date - 1,
  interval '1 day'
) d;
select is((select mind_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date,
  (date_trunc('week', current_date)::date - 7)::timestamptz, date_trunc('week', current_date)::date::timestamptz
)), 40::numeric, 'seven low-answer days earn the full 40 Mind participation points');

select is(round((select body_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), 2), 25.86::numeric, 'Body: Mini Partners manual credit, Energy participation and existing Sleep contribution retained');

select is(round((select bond_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), 2), 21.36::numeric, 'Bond: Mini Partners manual credit, Connection participation and existing Journal contribution retained');

select is(round((select mind_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), 2), 0.00::numeric, 'missing Mind check-in earns no participation points');

select is(round((select body_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), 2), 6.86::numeric, 'missing Energy check-in does not earn Body participation points');

select is(round((select bond_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), 2), 6.86::numeric, 'missing Connection check-in does not earn Bond participation points');

select is((select mind_has_data from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), false, 'missing Mind check-in remains unavailable rather than fabricated');

-- Changing every answer to its most positive value must not change any score.
create temporary table before_positive_answers on commit drop as
select mind_score, body_score, bond_score
from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
);
update public.mood_logs set mood_value = 5, stress_level = 1, energy_level = 5, connection_level = 5
where user_id = '76000000-0000-4000-8000-000000000001'
  and date >= date_trunc('week', current_date)::date
  and date < date_trunc('week', current_date)::date + 7;
select is((select mind_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), (select mind_score from before_positive_answers), 'positive answer change does not add Mind points');
select is((select body_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), (select body_score from before_positive_answers), 'positive answer change does not add Body points');
select is((select bond_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz, (date_trunc('week', current_date)::date + 7)::timestamptz
)), (select bond_score from before_positive_answers), 'positive answer change does not add Bond points');

select is(round((select mind_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date,
  (date_trunc('week', current_date)::date - 7)::timestamptz, date_trunc('week', current_date)::date::timestamptz
)), 2), 46.86::numeric, 'seven low-answer days plus proportional manual activity score correctly');

select is((select mind_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 14, date_trunc('week', current_date)::date - 7,
  (date_trunc('week', current_date)::date - 14)::timestamptz, (date_trunc('week', current_date)::date - 7)::timestamptz
)), 30::numeric, 'closed Change 07 week retains existing 70/30 calculation');

select is((select mind_score from public.calculate_dad_score_period(
  '76000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 21, date_trunc('week', current_date)::date - 14,
  (date_trunc('week', current_date)::date - 21)::timestamptz, (date_trunc('week', current_date)::date - 14)::timestamptz
)), 100::numeric, 'pre-Change 07 historical formula remains unchanged');

select is((select score_model_version from public.dad_score_history_view
  where user_id = '76000000-0000-4000-8000-000000000001'
    and week_start = date_trunc('week', current_date)::date),
  '60_40_10_30_v1', 'history labels new formula version');
select is((select score_model_version from public.dad_score_history_view
  where user_id = '76000000-0000-4000-8000-000000000001'
    and week_start = date_trunc('week', current_date)::date - 7),
  '60_40_10_30_v1', 'history labels adjacent comparable Mind week with new formula');
select is((select score_model_version from public.dad_score_history_view
  where user_id = '76000000-0000-4000-8000-000000000001'
    and week_start = date_trunc('week', current_date)::date - 14),
  'change_07_70_30', 'history labels Change 07 week to prevent mixed-model comparison');

-- Current and previous week both use the new version, so comparable trend resumes.
select is(round((select mind_week_change from public.dad_score_view
  where user_id = '76000000-0000-4000-8000-000000000001'), 2), (-34.29)::numeric,
  'trend compares adjacent weeks only after both use the same formula');

select * from finish();
rollback;
