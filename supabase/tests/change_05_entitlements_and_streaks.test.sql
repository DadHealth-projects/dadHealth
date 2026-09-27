begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('54000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'free-streak@example.test', '', now(), now(), now()),
  ('54000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro-streak@example.test', '', now(), now(), now()),
  ('54000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'weekly-freeze@example.test', '', now(), now(), now()),
  ('54000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expired-pro@example.test', '', now(), now(), now()),
  ('54000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manual-pro@example.test', '', now(), now(), now()),
  ('54000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'legacy-stripe-pro@example.test', '', now(), now(), now()),
  ('54000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trialing-pro@example.test', '', now(), now(), now());

insert into public.user_profile (user_id, is_pro)
select id, id = '54000000-0000-4000-8000-000000000005'::uuid from auth.users where id::text like '54000000-0000-4000-8000-00000000000%';

update public.user_profile set stripe_customer_id = 'cus_legacy_test', subscription_status = 'active'
where user_id = '54000000-0000-4000-8000-000000000006';

insert into public.subscription_entitlements (user_id, provider, provider_subscription_id, status, current_period_end)
values
  ('54000000-0000-4000-8000-000000000002', 'apple', 'streak-pro-grace', 'grace_period', now() + interval '1 day'),
  ('54000000-0000-4000-8000-000000000003', 'google', 'streak-pro-active', 'active', now() + interval '30 days'),
  ('54000000-0000-4000-8000-000000000004', 'apple', 'streak-pro-expired', 'active', now() - interval '1 day'),
  ('54000000-0000-4000-8000-000000000007', 'google', 'streak-pro-trial', 'trialing', now() + interval '1 day');

select ok(not public.user_has_pro_access('54000000-0000-4000-8000-000000000001'), 'Free user has no Pro streak access');
select ok(public.user_has_pro_access('54000000-0000-4000-8000-000000000005'), 'manual Pro grants access');
select ok(public.user_has_pro_access('54000000-0000-4000-8000-000000000006'), 'active legacy Stripe subscription grants access');
select ok(public.user_has_pro_access('54000000-0000-4000-8000-000000000002'), 'valid grace period grants Pro access');
select ok(public.user_has_pro_access('54000000-0000-4000-8000-000000000007'), 'valid trialing entitlement grants access');
select ok(not public.user_has_pro_access('54000000-0000-4000-8000-000000000004'), 'expired entitlement does not grant Pro access');

select is(public.record_streak_activity('54000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date - 21), 1, 'Pro streak starts at one');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date - 20), 2, 'consecutive day increments the streak');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date - 18), 3, 'Pro freeze bridges one actual missed day');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date - 18), 3, 'same-day replay is idempotent');
select is((select count(*)::integer from public.user_streak_freezes where user_id = '54000000-0000-4000-8000-000000000002'), 1, 'retry does not consume another freeze');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000002', date_trunc('week', current_date)::date - 16), 1, 'second missed day in the same week resets the streak');
select is((select count(*)::integer from public.user_streak_freezes where user_id = '54000000-0000-4000-8000-000000000002'), 1, 'second missed day cannot consume a second weekly freeze');

select is(public.record_streak_activity('54000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 21), 1, 'Free streak starts at one');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 20), 2, 'Free consecutive day increments the streak');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000001', date_trunc('week', current_date)::date - 18), 1, 'Free missed day resets instead of freezing');
select is((select count(*)::integer from public.user_streak_freezes where user_id = '54000000-0000-4000-8000-000000000001'), 0, 'Free user has no freeze records');

select is(public.record_streak_activity('54000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 14), 1, 'weekly test streak starts on Monday');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 13), 2, 'first activity increments');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 11), 3, 'first week consumes one freeze');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 10), 4, 'streak continues after first freeze');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 9), 5, 'streak continues through the week');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 8), 6, 'streak continues');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 7), 7, 'streak continues through the weekend');
select is(public.record_streak_activity('54000000-0000-4000-8000-000000000003', date_trunc('week', current_date)::date - 5), 8, 'next week allows one new freeze');
select is((select count(*)::integer from public.user_streak_freezes where user_id = '54000000-0000-4000-8000-000000000003'), 2, 'freeze records are scoped to separate Monday-Sunday weeks');

select ok(not has_table_privilege('authenticated', 'public.user_streaks', 'UPDATE'), 'authenticated clients cannot write authoritative streaks');
select ok((select relrowsecurity from pg_class where oid = 'public.user_streaks'::regclass), 'streak row access is protected by RLS');
select ok(not has_table_privilege('authenticated', 'public.dad_score_history_view', 'SELECT'), 'authenticated clients cannot directly read Pro score history');
select ok(has_table_privilege('service_role', 'public.dad_score_history_view', 'SELECT'), 'server service role can read score history');

select * from finish();
rollback;
