begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('81000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cook-free@example.test', '', now(), now(), now()),
  ('81000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cook-pro@example.test', '', now(), now(), now()),
  ('81000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cook-trial@example.test', '', now(), now(), now()),
  ('81000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cook-expired@example.test', '', now(), now(), now());

update public.user_profile set is_pro = true where user_id = '81000000-0000-4000-8000-000000000002';
insert into public.subscription_entitlements (user_id, provider, provider_subscription_id, status, current_period_end)
values
  ('81000000-0000-4000-8000-000000000003', 'apple', 'cook-trial', 'trialing', now() + interval '7 days'),
  ('81000000-0000-4000-8000-000000000004', 'apple', 'cook-expired', 'expired', now() - interval '1 day');

insert into public.recipes (id, title, difficulty, age_min, prep_mins, ingredients, steps, cook_together)
values
  ('82000000-0000-4000-8000-000000000001', 'Current featured recipe', 'easy', 3, 20, '[]', '[]', true),
  ('82000000-0000-4000-8000-000000000002', 'Next week recipe', 'easy', 3, 25, '[]', '[]', true),
  ('82000000-0000-4000-8000-000000000003', 'Unassigned recipe', 'medium', 5, 30, '[]', '[]', true),
  ('82000000-0000-4000-8000-000000000004', 'Another recipe', 'easy', 4, 15, '[]', '[]', true),
  ('82000000-0000-4000-8000-000000000005', 'Standard recipe', 'easy', 3, 10, '[]', '[]', false);

insert into public.user_saved_recipes (user_id, recipe_id)
values
  ('81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000003');

select is(
  (public.admin_set_free_weekly_recipe(date_trunc('week', current_date::timestamp)::date, '82000000-0000-4000-8000-000000000001')).recipe_id,
  '82000000-0000-4000-8000-000000000001'::uuid,
  'Admin assigns current week recipe'
);
select is(
  (public.admin_set_free_weekly_recipe(date_trunc('week', current_date::timestamp)::date + 7, '82000000-0000-4000-8000-000000000002')).recipe_id,
  '82000000-0000-4000-8000-000000000002'::uuid,
  'Admin can schedule next week without publishing it early'
);
select is(
  (public.admin_set_free_weekly_recipe(date_trunc('week', current_date::timestamp)::date, '82000000-0000-4000-8000-000000000004')).recipe_id,
  '82000000-0000-4000-8000-000000000004'::uuid,
  'rescheduling replaces the same week assignment'
);
select public.admin_set_free_weekly_recipe(date_trunc('week', current_date::timestamp)::date, '82000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.admin_set_free_weekly_recipe(date_trunc('week', current_date::timestamp)::date + 1, '82000000-0000-4000-8000-000000000001')$$,
  '22023', 'Week start must be a Monday.', 'Admin scheduling rejects non-Monday dates'
);
select throws_ok(
  $$select public.admin_set_free_weekly_recipe(date_trunc('week', current_date::timestamp)::date - 7, '82000000-0000-4000-8000-000000000001')$$,
  '22023', 'Past weeks cannot be rescheduled.', 'Admin scheduling rejects past weeks'
);
select throws_ok(
  $$select public.admin_set_free_weekly_recipe(date_trunc('week', current_date::timestamp)::date, '82000000-0000-4000-8000-000000000005')$$,
  '22023', 'Choose an existing Cook Together recipe.', 'Admin cannot assign a standard recipe'
);
select is(
  (select count(*)::integer from public.free_weekly_recipe_assignments where week_start = date_trunc('week', current_date::timestamp)::date + 14),
  0,
  'weeks without assignment stay empty'
);

set local role anon;
select is((select count(*)::integer from public.recipes where cook_together), 1, 'anonymous reads only current featured Cook Together recipe');
select is((select count(*)::integer from public.free_weekly_recipe_assignments), 1, 'anonymous sees current assignment only');
select is((select count(*)::integer from public.free_weekly_recipe_assignments where week_start > current_date), 0, 'future assignment is not visible early');
reset role;

delete from public.free_weekly_recipe_assignments
where week_start = date_trunc('week', current_date::timestamp)::date;
set local role anon;
select is((select count(*)::integer from public.recipes where cook_together), 0, 'no assignment exposes no arbitrary Cook Together recipe');
select is((select count(*)::integer from public.free_weekly_recipe_assignments), 0, 'no assignment returns an explicit empty result');
reset role;
select public.admin_set_free_weekly_recipe(date_trunc('week', current_date::timestamp)::date, '82000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.recipes where cook_together), 1, 'Free user sees one current recipe');
select ok(public.can_access_cook_together_recipe('82000000-0000-4000-8000-000000000001'), 'Free user can access current assignment');
select ok(not public.can_access_cook_together_recipe('82000000-0000-4000-8000-000000000002'), 'Free user cannot access next week recipe early');
select ok(not public.can_access_cook_together_recipe('82000000-0000-4000-8000-000000000003'), 'Free user cannot access unassigned recipe');
select lives_ok(
  $$insert into public.user_saved_recipes (user_id, recipe_id) values (auth.uid(), '82000000-0000-4000-8000-000000000001')$$,
  'Free user can save current assigned recipe'
);
select throws_ok(
  $$insert into public.user_saved_recipes (user_id, recipe_id) values (auth.uid(), '82000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'Free user cannot save inaccessible recipe'
);
select is((select count(*)::integer from public.user_saved_recipes where recipe_id = '82000000-0000-4000-8000-000000000002'), 1, 'saved Pro recipe record remains stored after downgrade');
select is((select count(*)::integer from public.user_saved_recipes saved join public.recipes recipe on recipe.id = saved.recipe_id where saved.recipe_id = '82000000-0000-4000-8000-000000000002'), 0, 'saved Pro recipe details remain hidden from Free user');
select is((select count(*)::integer from public.user_saved_recipes where user_id = auth.uid() and recipe_id = '82000000-0000-4000-8000-000000000003'), 1, 'saved inaccessible recipe remains stored until user removes it');
select lives_ok($$delete from public.user_saved_recipes where user_id = auth.uid() and recipe_id = '82000000-0000-4000-8000-000000000002'$$, 'Free user can unsave inaccessible Pro recipe after downgrade');
select is((select count(*)::integer from public.user_saved_recipes where user_id = auth.uid() and recipe_id = '82000000-0000-4000-8000-000000000002'), 0, 'unsaving removes only the selected saved recipe');
select lives_ok($$select public.complete_cook_together_recipe('82000000-0000-4000-8000-000000000001')$$, 'Free user can complete current assigned recipe');
select throws_ok(
  $$select public.complete_cook_together_recipe('82000000-0000-4000-8000-000000000002')$$,
  '42501', 'Recipe unavailable.', 'Free user cannot complete next week recipe early'
);
select is((select count(*)::integer from public.bond_logs where user_id = auth.uid() and recipe_id = '82000000-0000-4000-8000-000000000001' and activity_type = 'cook_together_recipe'), 1, 'completion preserves Bond activity logging');
select is((select coalesce(sum(value), 0)::integer from public.body_metrics where user_id = auth.uid() and metric_type = 'active_mins'), 20, 'completion preserves active minutes');
reset role;

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select ok(public.can_access_cook_together_recipe('82000000-0000-4000-8000-000000000003'), 'Pro user resolves full access');
select is((select count(*)::integer from public.recipes where cook_together), 4, 'Pro user sees full Cook Together library');
select lives_ok($$select public.complete_cook_together_recipe('82000000-0000-4000-8000-000000000003')$$, 'Pro user can complete unassigned recipe');
reset role;

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select ok(public.can_access_cook_together_recipe('82000000-0000-4000-8000-000000000003'), 'Trial user resolves full access');
select is((select count(*)::integer from public.recipes where cook_together), 4, 'Trial user sees full Cook Together library');
reset role;

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select ok(not public.can_access_cook_together_recipe('82000000-0000-4000-8000-000000000003'), 'expired subscription returns to Free access');
select is((select count(*)::integer from public.recipes where cook_together), 1, 'expired user sees current assignment only');
reset role;

update public.user_profile set is_pro = true where user_id = '81000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.recipes where cook_together), 4, 'renewed Pro user regains full library');
select is((select count(*)::integer from public.user_saved_recipes saved join public.recipes recipe on recipe.id = saved.recipe_id where saved.recipe_id = '82000000-0000-4000-8000-000000000003'), 1, 'remaining saved recipe details return when Pro access returns');
reset role;

select ok(not has_function_privilege('anon', 'public.admin_set_free_weekly_recipe(date,uuid)', 'EXECUTE'), 'anonymous clients cannot schedule recipes');
select ok(not has_function_privilege('authenticated', 'public.admin_set_free_weekly_recipe(date,uuid)', 'EXECUTE'), 'authenticated clients cannot schedule recipes');
select ok(has_function_privilege('service_role', 'public.admin_set_free_weekly_recipe(date,uuid)', 'EXECUTE'), 'Admin service role can schedule recipes');

select * from finish();
rollback;
