begin;

do $$
begin
  if to_regclass('public.workouts') is null
    or to_regclass('public.meal_plans') is null
    or to_regclass('public.subscription_entitlements') is null
    or to_regprocedure('public.user_has_pro_access(uuid)') is null then
    raise exception 'Saved Pro content prerequisites are missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workouts' and column_name = 'source'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'meal_plans' and column_name = 'source'
  ) then
    raise exception 'Saved Pro content source columns are missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profile' and column_name = 'manual_pro_grant'
  ) then
    raise exception 'Manual Pro grant foundation is missing; apply the foundation migration and classify legacy grants first.';
  end if;
  if exists (
    select 1 from public.subscription_entitlements
    where status in ('active', 'trialing', 'grace_period') and current_period_end is null
  ) then
    raise exception 'Active subscription expiry dates are unresolved; verify Apple, Google, and Stripe records before applying.';
  end if;
  if exists (
    select 1
    from public.user_profile profile
    where profile.stripe_subscription_id is not null
      and not exists (
        select 1 from public.subscription_entitlements entitlement
        where entitlement.user_id = profile.user_id
          and entitlement.provider = 'stripe'
          and entitlement.provider_subscription_id = profile.stripe_subscription_id
      )
  ) then
    raise exception 'A Stripe subscription is missing from the entitlement ledger; reconcile it before applying.';
  end if;
  if exists (
    select 1
    from public.user_profile profile
    where profile.is_pro
      and not profile.manual_pro_grant
      and not exists (
        select 1 from public.subscription_entitlements entitlement
        where entitlement.user_id = profile.user_id
          and entitlement.status in ('active', 'trialing', 'grace_period')
          and entitlement.current_period_end > now()
      )
  ) then
    raise exception 'Legacy Pro flags need manual-grant or stale-flag classification before applying.';
  end if;
  if exists (
    select 1
    from public.user_profile profile
    where profile.stripe_customer_id is not null
      and profile.subscription_status in ('active', 'trialing')
      and not exists (
        select 1 from public.subscription_entitlements entitlement
        where entitlement.user_id = profile.user_id
          and entitlement.provider = 'stripe'
          and entitlement.status in ('active', 'trialing', 'grace_period')
          and entitlement.current_period_end > now()
      )
  ) then
    raise exception 'Legacy Stripe status lacks verified unexpired provider data; reconcile it before applying.';
  end if;
end;
$$;

-- Manual grant is explicit. Legacy is_pro never overrides provider expiry.
create or replace function public.user_has_pro_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select profile.manual_pro_grant
    from public.user_profile profile
    where profile.user_id = p_user_id
  ), false)
  or exists (
    select 1
    from public.subscription_entitlements entitlement
    where entitlement.user_id = p_user_id
      and entitlement.status in ('active', 'trialing', 'grace_period')
      and entitlement.current_period_end is not null
      and entitlement.current_period_end > now()
  );
$$;

revoke all on function public.user_has_pro_access(uuid) from public, anon, authenticated;
grant execute on function public.user_has_pro_access(uuid) to service_role;

alter table public.workouts enable row level security;
alter table public.meal_plans enable row level security;

-- RLS policies call this current-user wrapper; raw resolver stays private
-- because it accepts arbitrary user IDs.
create or replace function public.current_user_has_pro_access()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and public.user_has_pro_access(auth.uid());
$$;

revoke all on function public.current_user_has_pro_access() from public, anon;
grant execute on function public.current_user_has_pro_access() to authenticated, service_role;

-- Admin workouts retain Pro/full-library and assigned-week access. Existing
-- generated templates remain stored, but only their owner with Pro can read them.
drop policy if exists "Users can read admin and own workouts" on public.workouts;
drop policy if exists "Read eligible workouts" on public.workouts;
drop policy if exists "Restrict workout reads to Pro or weekly assignment" on public.workouts;
create policy "Read eligible workouts"
on public.workouts for select to anon, authenticated
using (
  (
    source = 'admin'
    and (
      public.current_user_has_pro_workout_access()
      or exists (
        select 1 from public.free_weekly_workout_assignments assignment
        where assignment.workout_id = workouts.id
          and assignment.week_start = date_trunc('week', current_date::timestamp)::date
      )
    )
  )
  or (
    source = 'ai_generated'
    and auth.uid() is not null
    and auth.uid() = user_id
    and public.current_user_has_pro_access()
  )
);
create policy "Restrict workout reads to Pro or weekly assignment"
on public.workouts as restrictive for select to anon, authenticated
using (
  (
    source = 'admin'
    and (
      public.current_user_has_pro_workout_access()
      or exists (
        select 1 from public.free_weekly_workout_assignments assignment
        where assignment.workout_id = workouts.id
          and assignment.week_start = date_trunc('week', current_date::timestamp)::date
      )
    )
  )
  or (
    source = 'ai_generated'
    and auth.uid() is not null
    and auth.uid() = user_id
    and public.current_user_has_pro_access()
  )
);

-- Preserve ordinary meal-plan CRUD and user deletion. Pro-generated plans
-- require confirmed access for every read or update; Free users cannot relabel
-- an existing AI plan to bypass the read policy.
drop policy if exists "Users can CRUD own meal_plans" on public.meal_plans;
drop policy if exists "Users can read accessible own meal plans" on public.meal_plans;
drop policy if exists "Restrict meal plan reads to Pro" on public.meal_plans;
drop policy if exists "Users can insert own meal plans" on public.meal_plans;
drop policy if exists "Restrict meal plan inserts to Pro for AI plans" on public.meal_plans;
drop policy if exists "Users can update accessible own meal plans" on public.meal_plans;
drop policy if exists "Restrict meal plan updates to Pro for AI plans" on public.meal_plans;
drop policy if exists "Users can delete own meal plans" on public.meal_plans;
drop policy if exists "Restrict meal plan deletes to owner" on public.meal_plans;

create or replace function public.prevent_ai_meal_plan_source_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.source = 'ai_generated' and new.source is distinct from old.source then
    raise exception 'Generated meal plan source cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_ai_meal_plan_source_change() from public, anon, authenticated;
drop trigger if exists prevent_ai_meal_plan_source_change on public.meal_plans;
create trigger prevent_ai_meal_plan_source_change
before update of source on public.meal_plans
for each row execute function public.prevent_ai_meal_plan_source_change();

create policy "Users can read accessible own meal plans"
on public.meal_plans for select to authenticated
using (
  auth.uid() = user_id
  and (source is distinct from 'ai_generated' or public.current_user_has_pro_access())
);
create policy "Restrict meal plan reads to Pro"
on public.meal_plans as restrictive for select to authenticated
using (
  auth.uid() = user_id
  and (source is distinct from 'ai_generated' or public.current_user_has_pro_access())
);
create policy "Users can insert own meal plans"
on public.meal_plans for insert to authenticated
with check (
  auth.uid() = user_id
  and (source is distinct from 'ai_generated' or public.current_user_has_pro_access())
);
create policy "Restrict meal plan inserts to Pro for AI plans"
on public.meal_plans as restrictive for insert to authenticated
with check (
  auth.uid() = user_id
  and (source is distinct from 'ai_generated' or public.current_user_has_pro_access())
);
create policy "Users can update accessible own meal plans"
on public.meal_plans for update to authenticated
using (
  auth.uid() = user_id
  and (source is distinct from 'ai_generated' or public.current_user_has_pro_access())
)
with check (
  auth.uid() = user_id
  and (source is distinct from 'ai_generated' or public.current_user_has_pro_access())
);
create policy "Restrict meal plan updates to Pro for AI plans"
on public.meal_plans as restrictive for update to authenticated
using (
  auth.uid() = user_id
  and (source is distinct from 'ai_generated' or public.current_user_has_pro_access())
)
with check (
  auth.uid() = user_id
  and (source is distinct from 'ai_generated' or public.current_user_has_pro_access())
);
create policy "Users can delete own meal plans"
on public.meal_plans for delete to authenticated
using (auth.uid() = user_id);
create policy "Restrict meal plan deletes to owner"
on public.meal_plans as restrictive for delete to authenticated
using (auth.uid() = user_id);

-- Persist provider snapshots monotonically. Delayed older notifications cannot
-- replace newer verified state; granting states require a verified expiry.
create or replace function public.upsert_subscription_entitlement(
  p_user_id uuid,
  p_provider text,
  p_provider_subscription_id text,
  p_provider_account_id text,
  p_latest_transaction_id text,
  p_product_id text,
  p_plan text,
  p_status text,
  p_current_period_end timestamptz,
  p_trial_end timestamptz,
  p_auto_renews boolean,
  p_environment text,
  p_last_verified_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement_id uuid;
  existing_user uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_status in ('active', 'trialing', 'grace_period') and p_current_period_end is null then
    raise exception 'Verified subscription expiry is required for Pro access' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('subscription:' || p_user_id::text, 0));

  select user_id into existing_user
  from public.subscription_entitlements
  where provider = p_provider
    and provider_subscription_id = p_provider_subscription_id;
  if existing_user is not null and existing_user <> p_user_id then
    raise exception 'Subscription already belongs to another Dad Health account' using errcode = '23505';
  end if;

  insert into public.subscription_entitlements as current_entitlement (
    user_id, provider, provider_subscription_id, provider_account_id,
    latest_transaction_id, product_id, plan, status, current_period_end,
    trial_end, auto_renews, environment, last_verified_at, updated_at
  ) values (
    p_user_id, p_provider, p_provider_subscription_id, p_provider_account_id,
    p_latest_transaction_id, p_product_id, p_plan, p_status,
    p_current_period_end, p_trial_end, p_auto_renews, p_environment,
    coalesce(p_last_verified_at, now()), now()
  )
  on conflict (provider, provider_subscription_id) do update set
    provider_account_id = excluded.provider_account_id,
    latest_transaction_id = excluded.latest_transaction_id,
    product_id = excluded.product_id,
    plan = excluded.plan,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    trial_end = excluded.trial_end,
    auto_renews = excluded.auto_renews,
    environment = excluded.environment,
    last_verified_at = excluded.last_verified_at,
    updated_at = now()
  where current_entitlement.last_verified_at is null
     or excluded.last_verified_at >= current_entitlement.last_verified_at
  returning id into entitlement_id;

  if entitlement_id is null then
    select id into entitlement_id
    from public.subscription_entitlements
    where provider = p_provider
      and provider_subscription_id = p_provider_subscription_id;
  end if;
  return entitlement_id;
end;
$$;

revoke all on function public.upsert_subscription_entitlement(
  uuid, text, text, text, text, text, text, text, timestamptz,
  timestamptz, boolean, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.upsert_subscription_entitlement(
  uuid, text, text, text, text, text, text, text, timestamptz,
  timestamptz, boolean, text, timestamptz
) to service_role;

commit;
