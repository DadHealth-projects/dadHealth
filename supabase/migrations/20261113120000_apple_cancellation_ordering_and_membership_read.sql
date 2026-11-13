-- Forward-only correction. Apply after 20261112180000; do not rerun that migration.
-- Canonical entitlement ordering/access and legacy providers remain unchanged.
begin;

alter table public.subscription_cancellation_evidence
  drop constraint if exists subscription_cancellation_evidence_source_check;
alter table public.subscription_cancellation_evidence
  add constraint subscription_cancellation_evidence_source_check
  check (source in ('apple_renewal_disabled', 'apple_renewal_enabled', 'apple_terminal'));

comment on column public.subscription_cancellation_evidence.snapshot_verified_at is
  'Last explicit verified Apple event signing time; independent of purchase/restore verification time. Enabled/terminal markers prevent stale resurrection.';

create or replace function public.upsert_subscription_with_cancellation_evidence(p_snapshot jsonb, p_evidence jsonb default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  owner_id uuid := (p_snapshot->>'p_user_id')::uuid;
  accepted public.subscription_entitlements%rowtype;
  verified_at timestamptz := (p_snapshot->>'p_last_verified_at')::timestamptz;
  result_id uuid;
  evidence_source text := p_evidence->>'source';
  evidence_end timestamptz;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if owner_id is null or verified_at is null or not isfinite(verified_at)
     or p_snapshot->>'p_provider' is null then
    raise exception 'Invalid snapshot' using errcode='22023';
  end if;
  -- Same lock as the canonical upsert: snapshot and event evidence commit atomically.
  perform pg_advisory_xact_lock(hashtextextended('subscription:' || owner_id::text,0));
  result_id := public.upsert_subscription_entitlement(
    owner_id,p_snapshot->>'p_provider',p_snapshot->>'p_provider_subscription_id',p_snapshot->>'p_provider_account_id',
    p_snapshot->>'p_latest_transaction_id',p_snapshot->>'p_product_id',p_snapshot->>'p_plan',p_snapshot->>'p_status',
    (p_snapshot->>'p_current_period_end')::timestamptz,(p_snapshot->>'p_trial_end')::timestamptz,
    (p_snapshot->>'p_auto_renews')::boolean,p_snapshot->>'p_environment',verified_at);
  select * into strict accepted from public.subscription_entitlements where id=result_id;
  if accepted.user_id is distinct from owner_id then
    raise exception 'Subscription already belongs to another Dad Health account' using errcode='23505';
  end if;
  if accepted.provider <> 'apple' then
    if p_evidence is not null and p_evidence <> 'null'::jsonb then
      raise exception 'Cancellation evidence is Apple-only' using errcode='22023';
    end if;
    return result_id;
  end if;
  -- Purchase/restore has no explicit provider event: never infer reactivation.
  -- The membership reader still hides evidence when canonical access has expired.
  if p_evidence is null or p_evidence = 'null'::jsonb then return result_id; end if;
  if coalesce(evidence_source,'') not in ('apple_renewal_disabled','apple_renewal_enabled','apple_terminal') then
    raise exception 'Invalid cancellation evidence' using errcode='22023';
  end if;
  -- This timestamp comes from the signed notification, even when the canonical
  -- upsert rejected its older snapshot after a later server-time verification.
  evidence_end := case when evidence_source='apple_renewal_disabled'
    then (p_evidence->>'scheduledEndAt')::timestamptz else null end;
  if evidence_end is not null and not isfinite(evidence_end) then
    raise exception 'Invalid cancellation evidence' using errcode='22023';
  end if;
  insert into public.subscription_cancellation_evidence as current_evidence (
    subscription_id,user_id,source,snapshot_verified_at,scheduled_end_at
  ) values (result_id,owner_id,evidence_source,verified_at,evidence_end)
  on conflict (subscription_id) do update set
    source=excluded.source,
    snapshot_verified_at=excluded.snapshot_verified_at,
    scheduled_end_at=excluded.scheduled_end_at,
    recorded_at=now()
  where current_evidence.user_id=excluded.user_id
    and excluded.snapshot_verified_at > current_evidence.snapshot_verified_at;
  return result_id;
end;
$$;
revoke all on function public.upsert_subscription_with_cancellation_evidence(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_subscription_with_cancellation_evidence(jsonb,jsonb) to service_role;

-- STABLE keeps the joined read on the calling statement's snapshot. No separate
-- entitlement/evidence requests, and no changes to canonical/manual access.
create or replace function public.read_apple_membership_snapshot(p_user_id uuid)
returns table(subscription jsonb, evidence jsonb)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if p_user_id is null then raise exception 'User required' using errcode='22023'; end if;
  return query
    select to_jsonb(s), case when e.subscription_id is null then null else
      jsonb_build_object('source',e.source,'snapshot_verified_at',e.snapshot_verified_at,'scheduled_end_at',e.scheduled_end_at) end
    from public.subscription_entitlements s
    left join public.subscription_cancellation_evidence e on e.subscription_id=s.id and e.user_id=s.user_id
    where s.user_id=p_user_id and s.provider='apple';
end;
$$;
revoke all on function public.read_apple_membership_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.read_apple_membership_snapshot(uuid) to service_role;
commit;
