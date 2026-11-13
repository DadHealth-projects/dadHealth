-- Forward only. Does not change canonical access or the existing entitlement upsert.
begin;
-- Preserve the existing feedback table and its composite primary key.
create table if not exists public.subscription_cancellation_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  subscription_id uuid not null,
  reason text not null,
  details text,
  submitted_at timestamptz not null default now(),
  primary key (user_id, request_id),
  foreign key (subscription_id, user_id)
    references public.subscription_entitlements(id, user_id)
    on delete cascade
);

alter table public.subscription_cancellation_feedback
  add column if not exists retain_until timestamptz;

update public.subscription_cancellation_feedback
set retain_until = submitted_at + interval '12 months'
where retain_until is null;

alter table public.subscription_cancellation_feedback
  alter column retain_until set default (now() + interval '12 months'),
  alter column retain_until set not null;

-- Allow optional feedback text for every reason.
alter table public.subscription_cancellation_feedback
  drop constraint if exists subscription_cancellation_feedback_check;

alter table public.subscription_cancellation_feedback
  drop constraint if exists subscription_cancellation_feedback_details_check;

alter table public.subscription_cancellation_feedback
  add constraint subscription_cancellation_feedback_details_check
  check (details is null or char_length(details) <= 1000);

create index if not exists subscription_cancellation_feedback_retention
  on public.subscription_cancellation_feedback(retain_until);

alter table public.subscription_cancellation_feedback enable row level security;

revoke all on public.subscription_cancellation_feedback
  from public, anon, authenticated;

grant select, insert, delete
  on public.subscription_cancellation_feedback to service_role;

create table if not exists public.subscription_cancellation_evidence (
  subscription_id uuid primary key references public.subscription_entitlements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source = 'apple_renewal_disabled'),
  snapshot_verified_at timestamptz not null,
  scheduled_end_at timestamptz,
  recorded_at timestamptz not null default now()
);
alter table public.subscription_cancellation_evidence enable row level security;
revoke all on public.subscription_cancellation_evidence from public, anon, authenticated;
grant select, insert, update, delete on public.subscription_cancellation_evidence to service_role;

-- Replace the existing function using its original signature.
-- PostgreSQL cannot change a function's return type using CREATE OR REPLACE.
drop function if exists public.save_subscription_cancellation_feedback(
  uuid, uuid, uuid, text, text
);

create function public.save_subscription_cancellation_feedback(
  p_user_id uuid,
  p_request_id uuid,
  p_subscription_id uuid,
  p_reason text,
  p_details text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if p_user_id is null
     or p_request_id is null
     or p_subscription_id is null
     or p_reason is null
     or p_reason not in (
       'too_expensive', 'not_using', 'missing_feature',
       'technical_problem', 'other'
     )
     or char_length(coalesce(p_details, '')) > 1000 then
    raise exception 'Invalid feedback' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'cancellation-feedback:' || p_user_id::text || ':' || p_request_id::text,
      0
    )
  );

  if not exists (
    select 1
    from public.subscription_entitlements
    where id = p_subscription_id
      and user_id = p_user_id
      and provider = 'apple'
  ) then
    raise exception 'Subscription unavailable' using errcode = '42501';
  end if;

  insert into public.subscription_cancellation_feedback (
    user_id, request_id, subscription_id, reason, details
  )
  values (
    p_user_id, p_request_id, p_subscription_id,
    p_reason, p_details
  )
  on conflict (user_id, request_id) do nothing;

  if not exists (
    select 1
    from public.subscription_cancellation_feedback
    where user_id = p_user_id
      and request_id = p_request_id
      and subscription_id = p_subscription_id
      and reason = p_reason
      and details is not distinct from p_details
  ) then
    raise exception 'Feedback request already used' using errcode = '23505';
  end if;
end;
$$;

revoke all on function public.save_subscription_cancellation_feedback(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.save_subscription_cancellation_feedback(
  uuid, uuid, uuid, text, text
) to service_role;

-- Callable by an approved scheduler/operator; does not install or activate any job.
create or replace function public.cleanup_subscription_cancellation_feedback()
returns bigint language plpgsql security definer
set search_path = pg_catalog, public as $$
declare removed bigint;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  delete from public.subscription_cancellation_feedback where retain_until <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.cleanup_subscription_cancellation_feedback() from public,anon,authenticated;
grant execute on function public.cleanup_subscription_cancellation_feedback() to service_role;

-- Only this operation wraps the existing upsert. Its return signature is unchanged.
create or replace function public.upsert_subscription_with_cancellation_evidence(p_snapshot jsonb, p_evidence jsonb default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  owner_id uuid := (p_snapshot->>'p_user_id')::uuid;
  previous public.subscription_entitlements%rowtype;
  accepted public.subscription_entitlements%rowtype;
  verified_at timestamptz := (p_snapshot->>'p_last_verified_at')::timestamptz;
  result_id uuid;
  will_accept boolean;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if owner_id is null or verified_at is null
   or p_snapshot->>'p_provider' is null then
  raise exception 'Invalid snapshot' using errcode='22023';
end if;
  perform pg_advisory_xact_lock(hashtextextended('subscription:' || owner_id::text,0));
  select * into previous from public.subscription_entitlements
    where provider=p_snapshot->>'p_provider' and provider_subscription_id=p_snapshot->>'p_provider_subscription_id';
  will_accept := previous.id is null or previous.last_verified_at is null or verified_at > previous.last_verified_at;
  result_id := public.upsert_subscription_entitlement(
    owner_id,p_snapshot->>'p_provider',p_snapshot->>'p_provider_subscription_id',p_snapshot->>'p_provider_account_id',
    p_snapshot->>'p_latest_transaction_id',p_snapshot->>'p_product_id',p_snapshot->>'p_plan',p_snapshot->>'p_status',
    (p_snapshot->>'p_current_period_end')::timestamptz,(p_snapshot->>'p_trial_end')::timestamptz,
    (p_snapshot->>'p_auto_renews')::boolean,p_snapshot->>'p_environment',verified_at);
  if not will_accept then return result_id; end if;
  select * into strict accepted from public.subscription_entitlements where id=result_id;
  if accepted.user_id is distinct from owner_id then
    raise exception 'Subscription already belongs to another Dad Health account' using errcode='23505';
  end if;
  if accepted.last_verified_at is distinct from verified_at then return result_id; end if;
  -- Legacy providers retain their existing entitlement updates.
  -- Phase 04 cancellation evidence applies only to Apple.
  if accepted.provider <> 'apple' then
    if p_evidence is not null and p_evidence <> 'null'::jsonb then
      raise exception 'Cancellation evidence is Apple-only'
        using errcode='22023';
    end if;
    return result_id;
  end if;

  -- Evidence time is the accepted provider event time, not each later verification.
  -- Null evidence (purchase/restore) is not proof of reactivation.
  if p_evidence is not null and p_evidence <> 'null'::jsonb
     and coalesce(p_evidence->>'source','') not in ('apple_renewal_disabled','apple_renewal_enabled') then
    raise exception 'Invalid cancellation evidence' using errcode='22023';
  end if;
  if accepted.status not in ('active','trialing','grace_period')
     or accepted.current_period_end is null or accepted.current_period_end <= now()
     or p_evidence->>'source' = 'apple_renewal_enabled' then
    delete from public.subscription_cancellation_evidence where subscription_id=result_id;
  elsif p_evidence is not null and p_evidence <> 'null'::jsonb then
    if p_evidence->>'source' = 'apple_renewal_disabled' then
      if accepted.status in ('active','trialing','grace_period')
         and accepted.current_period_end > now() then

        insert into public.subscription_cancellation_evidence (
          subscription_id, user_id, source,
          snapshot_verified_at, scheduled_end_at
        )
        values (
          result_id, owner_id, 'apple_renewal_disabled',
          accepted.last_verified_at,
          accepted.current_period_end
        )
        on conflict (subscription_id) do update set
          source = excluded.source,
          snapshot_verified_at = excluded.snapshot_verified_at,
          scheduled_end_at = excluded.scheduled_end_at,
          recorded_at = now();
      end if;
    else
      raise exception 'Invalid cancellation evidence'
        using errcode='22023';
    end if;
  end if;
  return result_id;
end;
$$;
revoke all on function public.upsert_subscription_with_cancellation_evidence(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_subscription_with_cancellation_evidence(jsonb,jsonb) to service_role;
commit;
