begin;

-- Live production already has this compatibility/manual entitlement column.
-- Keep the committed schema safe to reapply without removing it.
alter table public.user_profile
  add column if not exists is_pro boolean not null default false;

-- Profile owners still need to update their normal profile fields, but billing
-- and entitlement fields must only be changed by trusted server code.
create or replace function public.protect_user_profile_subscription_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.is_pro is distinct from false
        or new.stripe_customer_id is not null
        or new.stripe_subscription_id is not null
        or new.subscription_status is not null then
        raise exception 'Subscription fields are server managed' using errcode = '42501';
      end if;
    elsif new.is_pro is distinct from old.is_pro
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.subscription_status is distinct from old.subscription_status then
      raise exception 'Subscription fields are server managed' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_user_profile_subscription_fields on public.user_profile;
create trigger protect_user_profile_subscription_fields
before insert or update on public.user_profile
for each row execute function public.protect_user_profile_subscription_fields();

create table if not exists public.subscription_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'apple', 'google')),
  provider_subscription_id text not null,
  provider_account_id text,
  latest_transaction_id text,
  product_id text,
  plan text check (plan is null or plan in ('monthly', 'annual')),
  status text not null check (status in (
    'pending', 'trialing', 'active', 'grace_period', 'past_due', 'paused',
    'canceled', 'expired', 'revoked', 'unpaid', 'incomplete',
    'incomplete_expired', 'unknown'
  )),
  current_period_end timestamptz,
  trial_end timestamptz,
  auto_renews boolean,
  environment text not null default 'production'
    check (environment in ('production', 'sandbox', 'test', 'legacy')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create index if not exists idx_subscription_entitlements_user
  on public.subscription_entitlements(user_id, updated_at desc);

create index if not exists idx_subscription_entitlements_access
  on public.subscription_entitlements(user_id, status, current_period_end);

alter table public.subscription_entitlements enable row level security;
revoke all on table public.subscription_entitlements from anon, authenticated;
grant select, insert, update, delete on table public.subscription_entitlements to service_role;

-- Google returns the obfuscated account reference in purchase verification and
-- RTDN data. Persist the one-way reference before launching Billing so an RTDN
-- arriving before the mobile verification request can still be attributed.
create table if not exists public.subscription_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'google'),
  account_reference text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  unique (provider, account_reference)
);

alter table public.subscription_account_links enable row level security;
revoke all on table public.subscription_account_links from anon, authenticated;
grant select, insert, update, delete on table public.subscription_account_links to service_role;

-- Apple and Google lifecycle notifications can be retried. Store identifiers
-- and processing state only; never persist webhook payloads or credentials.
create table if not exists public.subscription_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('apple', 'google')),
  event_id text not null,
  event_type text not null,
  environment text not null default 'production'
    check (environment in ('production', 'sandbox', 'test', 'legacy')),
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'completed', 'failed')),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, event_id)
);

alter table public.subscription_provider_events enable row level security;
revoke all on table public.subscription_provider_events from anon, authenticated;
grant select, insert, update, delete on table public.subscription_provider_events to service_role;

-- Authenticated verification routes are rate limited before they call Apple or
-- Google. Buckets use server-generated hashes and are not client-readable.
create table if not exists public.subscription_verification_rate_limits (
  bucket_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.subscription_verification_rate_limits enable row level security;
revoke all on table public.subscription_verification_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.subscription_verification_rate_limits to service_role;

create or replace function public.consume_subscription_verification_rate_limit(
  p_bucket_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if coalesce(p_bucket_hash, '') = '' or p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'Invalid rate-limit configuration';
  end if;

  insert into public.subscription_verification_rate_limits (
    bucket_hash, window_started_at, attempt_count, updated_at
  ) values (
    p_bucket_hash, now(), 1, now()
  )
  on conflict (bucket_hash) do update set
    window_started_at = case
      when subscription_verification_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds) then now()
      else subscription_verification_rate_limits.window_started_at
    end,
    attempt_count = case
      when subscription_verification_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds) then 1
      else subscription_verification_rate_limits.attempt_count + 1
    end,
    updated_at = now()
  returning attempt_count into next_count;

  return next_count <= p_limit;
end;
$$;

revoke all on function public.consume_subscription_verification_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_subscription_verification_rate_limit(text, integer, integer)
  to service_role;

create or replace function public.refresh_effective_subscription_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_status text;
  compatibility_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('subscription:' || p_user_id::text, 0));

  select e.status
    into provider_status
  from public.subscription_entitlements e
  where e.user_id = p_user_id
    and e.status in ('active', 'trialing', 'grace_period')
    and (e.current_period_end is null or e.current_period_end > now())
  order by
    case e.status when 'trialing' then 0 when 'grace_period' then 1 else 2 end,
    e.current_period_end desc nulls first,
    e.updated_at desc
  limit 1;

  if provider_status is null then
    select e.status
      into provider_status
    from public.subscription_entitlements e
    where e.user_id = p_user_id
    order by e.updated_at desc
    limit 1;
  end if;

  compatibility_status := case
    when provider_status = 'trialing' then 'trialing'
    when provider_status in ('active', 'grace_period') then 'active'
    else provider_status
  end;

  update public.user_profile
  set subscription_status = compatibility_status,
      updated_at = now()
  where user_id = p_user_id
    and subscription_status is distinct from compatibility_status;
end;
$$;

revoke all on function public.refresh_effective_subscription_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_effective_subscription_profile(uuid) to service_role;

create or replace function public.refresh_subscription_profile_after_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_user uuid;
begin
  affected_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform public.refresh_effective_subscription_profile(affected_user);

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform public.refresh_effective_subscription_profile(old.user_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_subscription_profile_after_entitlement
  on public.subscription_entitlements;
create trigger refresh_subscription_profile_after_entitlement
after insert or update or delete on public.subscription_entitlements
for each row execute function public.refresh_subscription_profile_after_entitlement();

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

  perform pg_advisory_xact_lock(hashtextextended('subscription:' || p_user_id::text, 0));

  select user_id into existing_user
  from public.subscription_entitlements
  where provider = p_provider
    and provider_subscription_id = p_provider_subscription_id;

  if existing_user is not null and existing_user <> p_user_id then
    raise exception 'Subscription already belongs to another user' using errcode = '23505';
  end if;

  insert into public.subscription_entitlements (
    user_id, provider, provider_subscription_id, provider_account_id,
    latest_transaction_id, product_id, plan, status, current_period_end,
    trial_end, auto_renews, environment, last_verified_at, updated_at
  ) values (
    p_user_id, p_provider, p_provider_subscription_id, p_provider_account_id,
    p_latest_transaction_id, p_product_id, p_plan, p_status,
    p_current_period_end, p_trial_end, p_auto_renews, p_environment,
    p_last_verified_at, now()
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
  returning id into entitlement_id;

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

create or replace function public.register_subscription_account_link(
  p_user_id uuid,
  p_provider text,
  p_account_reference text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_id uuid;
  existing_user uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_provider <> 'google' or coalesce(p_account_reference, '') = '' then
    raise exception 'Invalid account link';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('subscription:' || p_user_id::text, 0));

  select user_id into existing_user
  from public.subscription_account_links
  where provider = p_provider and account_reference = p_account_reference;

  if existing_user is not null and existing_user <> p_user_id then
    raise exception 'Account reference already belongs to another user' using errcode = '23505';
  end if;

  insert into public.subscription_account_links (
    user_id, provider, account_reference, updated_at
  ) values (
    p_user_id, p_provider, p_account_reference, now()
  )
  on conflict (user_id, provider) do update set
    account_reference = excluded.account_reference,
    updated_at = now()
  returning id into link_id;

  return link_id;
end;
$$;

revoke all on function public.register_subscription_account_link(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.register_subscription_account_link(uuid, text, text)
  to service_role;

create or replace function public.claim_subscription_provider_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_environment text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_id uuid;
  current_status text;
  current_claimed_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('subscription-event:' || p_provider || ':' || p_event_id, 0)
  );

  insert into public.subscription_provider_events (
    provider, event_id, event_type, environment
  ) values (
    p_provider, p_event_id, p_event_type, p_environment
  )
  on conflict (provider, event_id) do nothing
  returning id into claim_id;

  if claim_id is not null then
    return claim_id;
  end if;

  select id, processing_status, claimed_at
    into claim_id, current_status, current_claimed_at
  from public.subscription_provider_events
  where provider = p_provider and event_id = p_event_id;

  if current_status = 'completed' then
    return null;
  end if;
  if current_status = 'processing'
    and current_claimed_at > now() - interval '10 minutes' then
    return null;
  end if;

  update public.subscription_provider_events
  set processing_status = 'processing',
      claimed_at = now(),
      completed_at = null,
      error_code = null,
      updated_at = now()
  where id = claim_id;

  return claim_id;
end;
$$;

revoke all on function public.claim_subscription_provider_event(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_subscription_provider_event(text, text, text, text)
  to service_role;

create or replace function public.complete_subscription_provider_event(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.subscription_provider_events
  set processing_status = 'completed',
      completed_at = now(),
      error_code = null,
      updated_at = now()
  where id = p_claim_id;
end;
$$;

revoke all on function public.complete_subscription_provider_event(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_subscription_provider_event(uuid) to service_role;

create or replace function public.fail_subscription_provider_event(
  p_claim_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.subscription_provider_events
  set processing_status = 'failed',
      error_code = left(coalesce(p_error_code, 'processing_failed'), 100),
      updated_at = now()
  where id = p_claim_id;
end;
$$;

revoke all on function public.fail_subscription_provider_event(uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_subscription_provider_event(uuid, text) to service_role;

-- Preserve all existing Stripe-backed access. Rows without a persisted Stripe
-- subscription ID remain as legacy profile state until Stripe next reconciles.
insert into public.subscription_entitlements (
  user_id, provider, provider_subscription_id, provider_account_id,
  status, environment, last_verified_at, updated_at
)
select
  user_id,
  'stripe',
  stripe_subscription_id,
  stripe_customer_id,
  case
    when subscription_status in (
      'pending', 'trialing', 'active', 'grace_period', 'past_due', 'paused',
      'canceled', 'expired', 'revoked', 'unpaid', 'incomplete',
      'incomplete_expired', 'unknown'
    ) then subscription_status
    else 'unknown'
  end,
  'legacy',
  now(),
  now()
from public.user_profile
where stripe_subscription_id is not null
on conflict (provider, provider_subscription_id) do update set
  provider_account_id = excluded.provider_account_id,
  status = excluded.status,
  last_verified_at = excluded.last_verified_at,
  updated_at = now();

commit;
