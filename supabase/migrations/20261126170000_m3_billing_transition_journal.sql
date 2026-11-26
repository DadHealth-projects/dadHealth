-- Client audit A6: billing analytics transitions must not be lost after the verified
-- subscription save.
--
-- Before: upsert_subscription_analytics_snapshot committed the verified entitlement, then the
-- server separately called record_account_billing_analytics. A crash, timeout or failed call in
-- between lost the transition for good: a retry saw the new state as "previous".
--
-- Now: upsert_subscription_with_billing_journal saves the snapshot and, in the SAME transaction,
-- a journal row with the verified previous state and the verified adapter facts. The server
-- drains the journal through the existing record_account_billing_analytics, which checks the
-- separate account choice against the event's own time (no retrospective consent), withdrawal
-- and deletion, and dedupes on the event key. A row is removed only after every fact was
-- recorded or suppressed; otherwise it is retried, and it expires after 7 days (the brief's
-- unsent window). A journal problem can never fail the subscription save itself.
-- Nothing is collected unless ANALYTICS_BILLING_COLLECTION_ENABLED (and ingest/privacy) are on;
-- the server passes no journal otherwise. Delivery (job 32) is unaffected.
-- Depends on 20261120140000 (snapshot function) and 20261126130000 (record_account_billing_analytics).

create table if not exists public.billing_analytics_transitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null,
  provider text not null check (provider in ('apple', 'google', 'stripe')),
  environment text not null check (environment in ('sandbox', 'production', 'test')),
  provider_subscription_id text not null check (length(provider_subscription_id) between 1 and 256),
  verified_at timestamptz not null,
  previous jsonb,
  observed jsonb not null check (jsonb_typeof(observed) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  unique (provider, environment, provider_subscription_id, verified_at),
  foreign key (subscription_id, user_id) references public.subscription_entitlements(id, user_id) on delete cascade
);
create index if not exists billing_analytics_transitions_pending on public.billing_analytics_transitions (created_at);
create index if not exists billing_analytics_transitions_owner on public.billing_analytics_transitions (user_id, verified_at);
alter table public.billing_analytics_transitions enable row level security;
revoke all on table public.billing_analytics_transitions from public, anon, authenticated;

create or replace function public.upsert_subscription_with_billing_journal(p_snapshot jsonb, p_evidence jsonb, p_journal jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_result jsonb;
  v_journal uuid;
  v_failed boolean := false;
  v_previous jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  -- The verified save is exactly the existing one (locks, ordering, cancellation evidence).
  v_result := public.upsert_subscription_analytics_snapshot(p_snapshot, p_evidence);
  -- Journal only an accepted (not stale) snapshot, and never let it fail the save.
  -- A replay of an already applied verification (previous verified at the same time or later)
  -- is not a transition and is not journalled.
  if p_journal is not null and jsonb_typeof(p_journal) = 'object'
     and (v_result #>> '{current,last_verified_at}')::timestamptz = (p_snapshot ->> 'p_last_verified_at')::timestamptz
     and ((v_result #>> '{previous,last_verified_at}') is null
       or (v_result #>> '{previous,last_verified_at}')::timestamptz < (p_snapshot ->> 'p_last_verified_at')::timestamptz) then
    begin
      if exists (select 1 from jsonb_object_keys(p_journal) k
          where k not in ('status', 'autoRenews', 'latestTransactionId', 'trialEnd', 'trialFacts', 'verifiedPayment')) then
        raise exception 'Unexpected journal field' using errcode = '22023';
      end if;
      if jsonb_typeof(v_result -> 'previous') = 'object' then
        select jsonb_object_agg(e.key, e.value) into v_previous
          from jsonb_each(v_result -> 'previous') e
         where e.key in ('user_id', 'provider', 'environment', 'provider_subscription_id', 'status',
                         'auto_renews', 'trial_end', 'current_period_end', 'last_verified_at');
      end if;
      insert into public.billing_analytics_transitions(user_id, subscription_id, provider, environment,
        provider_subscription_id, verified_at, previous, observed)
      values ((p_snapshot ->> 'p_user_id')::uuid, (v_result ->> 'id')::uuid, p_snapshot ->> 'p_provider',
        p_snapshot ->> 'p_environment', p_snapshot ->> 'p_provider_subscription_id',
        (p_snapshot ->> 'p_last_verified_at')::timestamptz, v_previous,
        p_journal || jsonb_build_object('trialPeriodEndsAt', v_result #>> '{trialPeriod,endsAt}'))
      on conflict (provider, environment, provider_subscription_id, verified_at) do nothing
      returning id into v_journal;
    exception when others then
      v_failed := true;
      v_journal := null;
    end;
  end if;
  return v_result || jsonb_build_object('journalId', v_journal, 'journalFailed', v_failed);
end;
$function$;

-- Pending transitions, oldest first. Expired rows (older than 7 days) are removed, never sent.
create or replace function public.pending_billing_analytics_transitions(p_owner uuid, p_limit integer)
returns setof public.billing_analytics_transitions
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  delete from public.billing_analytics_transitions where created_at < clock_timestamp() - interval '7 days';
  return query
  with picked as (
    select t.id from public.billing_analytics_transitions t
     where p_owner is null or t.user_id = p_owner
     order by t.verified_at, t.id
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     for update skip locked
  )
  update public.billing_analytics_transitions t set attempts = t.attempts + 1
    from picked where t.id = picked.id
  returning t.*;
end;
$function$;

-- Called only after every fact of the row was recorded or suppressed by the consent check.
create or replace function public.complete_billing_analytics_transition(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  delete from public.billing_analytics_transitions where id = p_id;
  return found;
end;
$function$;

revoke all on function public.upsert_subscription_with_billing_journal(jsonb, jsonb, jsonb),
  public.pending_billing_analytics_transitions(uuid, integer),
  public.complete_billing_analytics_transition(uuid) from public, anon, authenticated;
grant execute on function public.upsert_subscription_with_billing_journal(jsonb, jsonb, jsonb),
  public.pending_billing_analytics_transitions(uuid, integer),
  public.complete_billing_analytics_transition(uuid) to service_role;
