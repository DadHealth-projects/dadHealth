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
          where k not in ('status', 'autoRenews', 'latestTransactionId', 'trialEnd', 'trialFacts', 'verifiedPayment', 'retentionOffer')) then
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

-- ---------------------------------------------------------------------------------------------
-- Recording journalled facts.
-- 1. record_verified_billing_analytics (20261120130000) accepted a fact only while its
--    verification was still the subscription's latest. A journalled transition is drained after
--    later verifications may have arrived (the exact crash case), so it would be suppressed and
--    lost. It now also accepts a verification proven by this subscription's journal row, which
--    only upsert_subscription_with_billing_journal writes, for an accepted snapshot.
-- 2. Brief 06 "50% offer accepted": retention_offer_accepted joins the allowlist. It comes only
--    from an Apple-verified transaction carrying our promotional offer (journalled with the save).
-- Otherwise the definition is unchanged (same signature, owner, grants, locks and checks).
create or replace function public.record_verified_billing_analytics(p_owner uuid,p_consent uuid,p_hash text,p_provider text,p_environment text,
 p_subscription text,p_verified_at timestamptz,p_event text,p_key text,p_at timestamptz,p_properties jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_event not in ('trial_started','trial_converted','trial_cancelled','subscription_cancelled','retention_offer_accepted')
  or p_key !~ '^billing:[a-f0-9]{64}$' then return false; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_owner::text,0));
 perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_consent::text,0));
 if not exists(select 1 from public.analytics_consents where id=p_consent and user_id=p_owner and secret_hash=p_hash and revoked_at is null and expires_at>clock_timestamp()) then return false; end if;
 if not exists(select 1 from public.subscription_entitlements where user_id=p_owner and provider=p_provider and environment=p_environment
  and provider_subscription_id=p_subscription and last_verified_at=p_verified_at)
 and not exists(select 1 from public.billing_analytics_transitions t where t.user_id=p_owner and t.provider=p_provider
  and t.environment=p_environment and t.provider_subscription_id=p_subscription and t.verified_at=p_verified_at) then return false; end if;
 return public.enqueue_analytics_fact(p_owner,p_consent,p_event,p_properties,p_key,p_at);
end $$;

-- 3. Brief 06 "trial cancelled with reason": the reason is linked here, in SQL, never taken from
--    the caller (which must still send 'unavailable'). Only a structured reason the member gave
--    for this same subscription inside the observed interval (after the previous verification,
--    up to the one that saw the cancellation) is used; otherwise 'unavailable'. Free-text details
--    are never read. Otherwise unchanged from 20261126130000.
create or replace function public.record_account_billing_analytics(p_owner uuid,p_provider text,p_environment text,p_subscription text,
 p_verified_at timestamptz,p_event text,p_key text,p_at timestamptz,p_properties jsonb,p_observed_after timestamptz default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.account_billing_analytics_consent; credential public.analytics_consents; props jsonb:=p_properties; linked text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_owner::text,0));
 if exists(select 1 from public.account_deletion_tombstones where user_id=p_owner) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics-billing:'||p_owner::text,0));
 select * into c from public.account_billing_analytics_consent where user_id=p_owner for update;
 if not found or not c.granted or p_at is null or p_verified_at is null or p_at<c.granted_at or p_verified_at<c.granted_at then return false; end if;
 -- Snapshot-based cancellation has an observation interval, not an invented
 -- occurrence date. The whole interval must follow consent, otherwise suppress.
 if p_event in ('trial_cancelled','subscription_cancelled') and
 (p_observed_after is null or p_observed_after<c.granted_at or p_observed_after>p_at) then return false; end if;
 if p_properties is null or jsonb_typeof(p_properties)<>'object' or p_properties->>'provider' is distinct from p_provider
 or p_properties->>'environment' is distinct from p_environment or p_provider not in ('apple','google','stripe')
 or p_environment not in ('sandbox','production','test')
 or exists(select 1 from jsonb_object_keys(p_properties) k where k not in ('provider','environment','reason'))
 or (p_properties ? 'reason' and p_properties->>'reason'<>'unavailable') then return false; end if;
 if p_event in ('trial_cancelled','subscription_cancelled') then
  select f.reason into linked from public.subscription_cancellation_feedback f
   join public.subscription_entitlements e on e.id=f.subscription_id and e.user_id=f.user_id
   where f.user_id=p_owner and e.provider=p_provider and e.provider_subscription_id=p_subscription
    and f.submitted_at>p_observed_after and f.submitted_at<=p_at
    and f.reason in ('too_expensive','not_using','missing_feature','technical_problem','other')
   order by f.submitted_at desc limit 1;
  props:=jsonb_set(props,'{reason}',to_jsonb(coalesce(linked,'unavailable')));
 end if;
 -- This internal queue scope has no client capability. Expiry never re-enables a
 -- withdrawn account preference. Device credential renewal is unchanged.
 if c.consent_id is null then
  insert into public.analytics_consents(id,user_id,secret_hash,distinct_id)
  values(gen_random_uuid(),p_owner,encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),p_owner::text)
  returning * into credential;
  update public.account_billing_analytics_consent set consent_id=credential.id where user_id=p_owner;
 else
  perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||c.consent_id::text,0));
  select * into credential from public.analytics_consents where id=c.consent_id;
  if credential.revoked_at is not null then return false; end if;
  update public.analytics_consents set expires_at=greatest(expires_at,clock_timestamp()+interval '30 days') where id=credential.id;
 end if;
 return public.record_verified_billing_analytics(p_owner,credential.id,credential.secret_hash,p_provider,p_environment,p_subscription,
  p_verified_at,p_event,p_key,p_at,props);
end $$;
