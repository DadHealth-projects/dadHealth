begin;

-- Fail closed unless Production already has the trigger path this migration
-- extends. Review stripe_profile_trigger_preflight.sql before applying.
do $$
declare
  trigger_function_definition text;
  refresh_function_definition text;
  upsert_function_definition text;
  existing_trigger oid;
begin
  if to_regclass('public.subscription_entitlements') is null
    or to_regclass('public.user_profile') is null then
    raise exception 'Subscription profile sync prerequisites are missing.';
  end if;

  if to_regprocedure('public.upsert_subscription_entitlement(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,timestamptz)') is null then
    raise exception 'Subscription entitlement upsert is missing; verify Production first.';
  end if;

  select trigger_row.oid, pg_get_functiondef(trigger_row.tgfoid)
    into existing_trigger, trigger_function_definition
  from pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.subscription_entitlements'::regclass
    and trigger_row.tgname = 'refresh_subscription_profile_after_entitlement'
    and not trigger_row.tgisinternal
  limit 1;

  if existing_trigger is not null then
    if not exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.oid = existing_trigger
        and trigger_row.tgfoid = to_regprocedure('public.refresh_subscription_profile_after_entitlement()')
        and trigger_row.tgenabled in ('O', 'A')
        and (trigger_row.tgtype & 1) = 1
        and (trigger_row.tgtype & 2) = 0
        and (trigger_row.tgtype & 28) = 28
    ) then
      raise exception 'Production profile trigger differs from the reviewed trigger contract; migration stopped.';
    end if;
    if position('refresh_effective_subscription_profile' in trigger_function_definition) = 0 then
      raise exception 'Production trigger does not call the expected refresh function; migration stopped.';
    end if;
  end if;

  if to_regprocedure('public.refresh_effective_subscription_profile(uuid)') is not null then
    select pg_get_functiondef('public.refresh_effective_subscription_profile(uuid)'::regprocedure)
      into refresh_function_definition;
    if position('pg_advisory_xact_lock' in refresh_function_definition) = 0
      or position('update public.user_profile' in refresh_function_definition) = 0 then
      raise exception 'Production refresh function differs from the reviewed implementation; migration stopped.';
    end if;
  end if;

  select pg_get_functiondef('public.upsert_subscription_entitlement(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,timestamptz)'::regprocedure)
    into upsert_function_definition;
  if position('pg_advisory_xact_lock' in upsert_function_definition) = 0
    or position('excluded.last_verified_at >= current_entitlement.last_verified_at' in upsert_function_definition) = 0
    or position('Verified subscription expiry is required for Pro access' in upsert_function_definition) = 0 then
    raise exception 'Production entitlement upsert differs from the reviewed implementation; migration stopped.';
  end if;

  if exists (
    select 1
    from pg_trigger trigger_row
    join pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
    where trigger_row.tgrelid = 'public.subscription_entitlements'::regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname <> 'refresh_subscription_profile_after_entitlement'
      and (
        position('user_profile' in pg_get_functiondef(trigger_function.oid)) > 0
        or position('refresh_effective_subscription_profile' in pg_get_functiondef(trigger_function.oid)) > 0
      )
  ) then
    raise exception 'Another entitlement trigger may also write profile state; inspect Production definitions first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profile' and column_name = 'stripe_customer_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profile' and column_name = 'stripe_subscription_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profile' and column_name = 'subscription_status'
  ) then
    raise exception 'Required user_profile billing columns are missing.';
  end if;
end;
$$;

-- Serialize each user's provider writes and reject older or tied snapshots.
-- Equal timestamps are ambiguous at millisecond precision, so fail closed.
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
set search_path = pg_catalog, public
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
     or excluded.last_verified_at > current_entitlement.last_verified_at
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

-- Called by the existing AFTER ROW trigger, inside the same transaction as
-- the monotonic entitlement upsert. The per-user advisory lock serializes all
-- provider updates and prevents application-side profile races.
create or replace function public.refresh_effective_subscription_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  provider_status text;
  compatibility_status text;
  v_stripe_customer_id text;
  v_stripe_subscription_id text;
  has_stripe_snapshot boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('subscription:' || p_user_id::text, 0));

  select entitlement.status
    into provider_status
  from public.subscription_entitlements entitlement
  where entitlement.user_id = p_user_id
    and entitlement.status in ('active', 'trialing', 'grace_period')
    and entitlement.current_period_end is not null
    and entitlement.current_period_end > now()
  order by
    case entitlement.status when 'trialing' then 0 when 'grace_period' then 1 else 2 end,
    entitlement.current_period_end desc,
    entitlement.last_verified_at desc nulls last,
    entitlement.updated_at desc
  limit 1;

  if provider_status is null then
    select case
      when entitlement.status in ('active', 'trialing', 'grace_period')
        and entitlement.current_period_end is null then 'unknown'
      when entitlement.status in ('active', 'trialing', 'grace_period')
        and entitlement.current_period_end <= now() then 'expired'
      else entitlement.status
    end
      into provider_status
    from public.subscription_entitlements entitlement
    where entitlement.user_id = p_user_id
    order by entitlement.last_verified_at desc nulls last, entitlement.updated_at desc
    limit 1;
  end if;

  compatibility_status := case
    when provider_status = 'trialing' then 'trialing'
    when provider_status in ('active', 'grace_period') then 'active'
    else provider_status
  end;

  select entitlement.provider_account_id, entitlement.provider_subscription_id
    into v_stripe_customer_id, v_stripe_subscription_id
  from public.subscription_entitlements entitlement
  where entitlement.user_id = p_user_id
    and entitlement.provider = 'stripe'
  order by entitlement.last_verified_at desc nulls last,
           entitlement.updated_at desc,
           entitlement.created_at desc
  limit 1;
  has_stripe_snapshot := found;

  update public.user_profile profile
  set subscription_status = compatibility_status,
      stripe_customer_id = case
        when has_stripe_snapshot then coalesce(v_stripe_customer_id, profile.stripe_customer_id)
        else profile.stripe_customer_id
      end,
      stripe_subscription_id = case
        when has_stripe_snapshot then v_stripe_subscription_id
        else profile.stripe_subscription_id
      end,
      updated_at = now()
  where profile.user_id = p_user_id
    and (
      profile.subscription_status is distinct from compatibility_status
      or (has_stripe_snapshot and profile.stripe_customer_id is distinct from coalesce(v_stripe_customer_id, profile.stripe_customer_id))
      or (has_stripe_snapshot and profile.stripe_subscription_id is distinct from v_stripe_subscription_id)
    );
end;
$$;

revoke all on function public.refresh_effective_subscription_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_effective_subscription_profile(uuid) to service_role;

create or replace function public.refresh_subscription_profile_after_entitlement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected_user uuid;
begin
  affected_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform public.refresh_effective_subscription_profile(affected_user);
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform public.refresh_effective_subscription_profile(old.user_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.refresh_subscription_profile_after_entitlement()
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.subscription_entitlements'::regclass
      and trigger_row.tgname = 'refresh_subscription_profile_after_entitlement'
      and not trigger_row.tgisinternal
  ) then
    execute 'create trigger refresh_subscription_profile_after_entitlement
      after insert or update or delete on public.subscription_entitlements
      for each row execute function public.refresh_subscription_profile_after_entitlement()';
  end if;
end;
$$;

-- Bring existing compatibility profile fields in line with their entitlement
-- ledger rows. No entitlement, manual grant, or saved content is changed.
do $$
declare
  entitlement_user record;
begin
  for entitlement_user in
    select distinct user_id from public.subscription_entitlements
  loop
    perform public.refresh_effective_subscription_profile(entitlement_user.user_id);
  end loop;
end;
$$;

commit;
