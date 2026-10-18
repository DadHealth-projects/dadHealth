begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saved-free@example.test', '', now(), now(), now()),
  ('91000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saved-pro@example.test', '', now(), now(), now()),
  ('91000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saved-trial@example.test', '', now(), now(), now()),
  ('91000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saved-paid-through@example.test', '', now(), now(), now()),
  ('91000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saved-expired@example.test', '', now(), now(), now()),
  ('91000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saved-renewed@example.test', '', now(), now(), now()),
  ('91000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saved-manual@example.test', '', now(), now(), now());

update public.user_profile set is_pro = true where user_id = '91000000-0000-4000-8000-000000000002';
update public.user_profile set is_pro = true, manual_pro_grant = true where user_id = '91000000-0000-4000-8000-000000000007';
update public.user_profile set is_pro = true where user_id = '91000000-0000-4000-8000-000000000005';
insert into public.subscription_entitlements (user_id, provider, provider_subscription_id, status, current_period_end, auto_renews)
values
  ('91000000-0000-4000-8000-000000000002', 'apple', 'saved-pro', 'active', now() + interval '30 days', true),
  ('91000000-0000-4000-8000-000000000003', 'apple', 'saved-trial', 'trialing', now() + interval '7 days', true),
  ('91000000-0000-4000-8000-000000000004', 'google', 'saved-paid-through', 'active', now() + interval '3 days', false),
  ('91000000-0000-4000-8000-000000000005', 'apple', 'saved-expired', 'expired', now() - interval '1 day', false),
  ('91000000-0000-4000-8000-000000000006', 'google', 'saved-renewed', 'expired', now() - interval '1 day', false);

insert into public.workouts (id, user_id, title, duration_mins, equipment, focus, exercises, source)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Saved Free AI workout', 10, 'none', 'core', '[]', 'ai_generated'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'Saved Pro AI workout', 10, 'none', 'core', '[]', 'ai_generated'),
  ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', 'Saved Trial AI workout', 10, 'none', 'core', '[]', 'ai_generated'),
  ('92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000004', 'Saved Paid AI workout', 10, 'none', 'core', '[]', 'ai_generated'),
  ('92000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000005', 'Saved Expired AI workout', 10, 'none', 'core', '[]', 'ai_generated'),
  ('92000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000006', 'Saved Renewed AI workout', 10, 'none', 'core', '[]', 'ai_generated'),
  ('92000000-0000-4000-8000-000000000008', '91000000-0000-4000-8000-000000000007', 'Saved Manual AI workout', 10, 'none', 'core', '[]', 'ai_generated'),
  ('92000000-0000-4000-8000-000000000007', null, 'Weekly Free workout', 10, 'none', 'full_body', '[]', 'admin');
insert into public.free_weekly_workout_assignments (week_start, workout_id)
values (date_trunc('week', current_date::timestamp)::date, '92000000-0000-4000-8000-000000000007');

insert into public.meal_plans (id, user_id, source, plan)
values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'ai_generated', '{"secret":"free plan"}'),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'user_custom', '{"name":"custom plan"}'),
  ('93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000002', 'ai_generated', '{"secret":"pro plan"}'),
  ('93000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000003', 'ai_generated', '{"secret":"trial plan"}'),
  ('93000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000004', 'ai_generated', '{"secret":"paid plan"}'),
  ('93000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000005', 'ai_generated', '{"secret":"expired plan"}'),
  ('93000000-0000-4000-8000-000000000007', '91000000-0000-4000-8000-000000000006', 'ai_generated', '{"secret":"renewed plan"}'),
  ('93000000-0000-4000-8000-000000000008', '91000000-0000-4000-8000-000000000007', 'ai_generated', '{"secret":"manual plan"}');
insert into public.workout_sessions (user_id, exercise_name, duration_minutes, performed_at)
values ('91000000-0000-4000-8000-000000000005', 'Completed workout history', 10, now() - interval '1 day');

select is((select count(*)::integer from public.meal_plans where source = 'ai_generated'), 7, 'all generated meal records remain stored');
select is((select count(*)::integer from public.workouts where source = 'ai_generated'), 7, 'all generated workout templates remain stored');

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select ok(not public.current_user_has_pro_access(), 'Free user fails canonical Pro resolver');
select is((select count(*)::integer from public.meal_plans where id = '93000000-0000-4000-8000-000000000001'), 0, 'Free cannot read saved AI meal plan');
select is((select count(*)::integer from public.meal_plans where id = '93000000-0000-4000-8000-000000000002'), 1, 'Free retains access to ordinary custom meal plan');
select is((select count(*)::integer from public.workouts where id = '92000000-0000-4000-8000-000000000001'), 0, 'Free cannot read saved AI workout template');
select is((select count(*)::integer from public.workouts where id = '92000000-0000-4000-8000-000000000007'), 1, 'Free retains assigned weekly Admin workout');
select is((with removed as (delete from public.meal_plans where id = '93000000-0000-4000-8000-000000000001' returning 1) select count(*)::integer from removed), 1, 'Free can delete own inaccessible saved plan');
reset role;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select ok(public.current_user_has_pro_access(), 'active Pro passes canonical resolver');
select is((select count(*)::integer from public.meal_plans where id = '93000000-0000-4000-8000-000000000003'), 1, 'active Pro can read saved AI meal plan');
select is((select count(*)::integer from public.workouts where id = '92000000-0000-4000-8000-000000000002'), 1, 'active Pro can read saved AI workout');
select throws_ok($$update public.meal_plans set source = 'user_custom' where id = '93000000-0000-4000-8000-000000000003'$$, '42501', 'Generated meal plan source cannot be changed.', 'AI plan cannot be relabeled to bypass downgrade lock');
reset role;

update public.subscription_entitlements
set last_verified_at = now(), provider_account_id = 'cus-saved-pro'
where provider_subscription_id = 'saved-pro';
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.upsert_subscription_entitlement(
  '91000000-0000-4000-8000-000000000002', 'apple', 'saved-pro', null, 'stale-transaction',
  'test-product', 'monthly', 'expired', now() - interval '1 day', null, false,
  'production', now() - interval '1 day'
);
select is((select status from public.subscription_entitlements where provider_subscription_id = 'saved-pro'), 'active', 'older provider update cannot overwrite newer Pro state');
select public.upsert_subscription_entitlement(
  '91000000-0000-4000-8000-000000000002', 'apple', 'saved-pro', 'cus-stale', 'tied-transaction',
  'test-product', 'monthly', 'expired', now() - interval '1 day', null, false,
  'production', (select last_verified_at from public.subscription_entitlements where provider_subscription_id = 'saved-pro')
);
select is((select status from public.subscription_entitlements where provider_subscription_id = 'saved-pro'), 'active', 'equal-time concurrent snapshot cannot replace accepted state');
select is((select subscription_status from public.user_profile where user_id = '91000000-0000-4000-8000-000000000002'), 'active', 'older webhook cannot overwrite the transaction-synchronized profile status');
select is((select stripe_customer_id from public.user_profile where user_id = '91000000-0000-4000-8000-000000000002'), 'cus-saved-pro', 'profile keeps customer ID from the accepted entitlement snapshot');
select is((select stripe_subscription_id from public.user_profile where user_id = '91000000-0000-4000-8000-000000000002'), 'saved-pro', 'profile keeps subscription ID from the accepted entitlement snapshot');
select throws_ok(
  $$select public.upsert_subscription_entitlement(
    '91000000-0000-4000-8000-000000000002', 'apple', 'saved-pro', null, 'missing-expiry',
    'test-product', 'monthly', 'active', null, null, true, 'production', now()
  )$$,
  '22023', 'Verified subscription expiry is required for Pro access', 'provider cannot write active access without expiry'
);
reset role;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select ok(public.current_user_has_pro_access(), 'Trial passes canonical resolver');
select is((select count(*)::integer from public.meal_plans where id = '93000000-0000-4000-8000-000000000004'), 1, 'Trial can read saved AI meal plan');
select is((select count(*)::integer from public.workouts where id = '92000000-0000-4000-8000-000000000003'), 1, 'Trial can read saved AI workout');
reset role;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select ok(public.current_user_has_pro_access(), 'cancelled subscription retains access through paid period');
select is((select count(*)::integer from public.meal_plans where id = '93000000-0000-4000-8000-000000000005'), 1, 'cancelled-but-paid user can read saved plan');
select is((select count(*)::integer from public.workouts where id = '92000000-0000-4000-8000-000000000004'), 1, 'cancelled-but-paid user can read saved workout');
reset role;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select ok(not public.current_user_has_pro_access(), 'expired user with legacy is_pro=true fails canonical resolver');
select is((select count(*)::integer from public.meal_plans where id = '93000000-0000-4000-8000-000000000006'), 0, 'expired user cannot read saved plan');
select is((select count(*)::integer from public.workouts where id = '92000000-0000-4000-8000-000000000005'), 0, 'expired user cannot read saved workout');
reset role;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select ok(public.current_user_has_pro_access(), 'manual grant without subscription retains Pro access');
select is((select count(*)::integer from public.meal_plans where id = '93000000-0000-4000-8000-000000000008'), 1, 'manual grant can read saved AI plan');
select is((select count(*)::integer from public.workouts where id = '92000000-0000-4000-8000-000000000008'), 1, 'manual grant can read saved AI workout');
reset role;

select ok(exists (select 1 from public.meal_plans where id = '93000000-0000-4000-8000-000000000006'), 'expired saved plan remains stored');
select is((select count(*)::integer from public.workout_sessions where user_id = '91000000-0000-4000-8000-000000000005'), 1, 'completed workout history remains stored');

update public.subscription_entitlements
set status = 'active', current_period_end = now() + interval '20 days', auto_renews = true
where user_id = '91000000-0000-4000-8000-000000000006' and provider_subscription_id = 'saved-renewed';
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select ok(public.current_user_has_pro_access(), 'renewed user regains canonical Pro access');
select is((select count(*)::integer from public.meal_plans where id = '93000000-0000-4000-8000-000000000007'), 1, 'renewed user regains saved plan');
select is((select count(*)::integer from public.workouts where id = '92000000-0000-4000-8000-000000000006'), 1, 'renewed user regains saved workout');
reset role;

select * from finish();
rollback;
