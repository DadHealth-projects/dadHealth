begin;
-- Account preference, not a device credential. No client table access.
create table public.account_billing_analytics_consent (
 user_id uuid primary key references auth.users(id) on delete cascade,
 granted boolean not null default false,
 granted_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 revision integer not null default 0 check(revision >= 0),
 operation_id uuid,
 consent_id uuid references public.analytics_consents(id) on delete set null,
 check (not granted or granted_at is not null)
);
alter table public.account_billing_analytics_consent enable row level security;
revoke all on public.account_billing_analytics_consent from public,anon,authenticated,service_role;
-- Only these guarded RPCs can write. No generic write trigger: FK SET NULL
-- during privacy retention cleanup must remain possible after a tombstone.

create function public.billing_analytics_choice(p_owner uuid,p_granted boolean default null,p_revision integer default null,p_operation uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.account_billing_analytics_consent; cid uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_owner is null then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_owner::text,0));
 if exists(select 1 from public.account_deletion_tombstones where user_id=p_owner)
 or not exists(select 1 from auth.users where id=p_owner) then raise exception 'Account unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics-billing:'||p_owner::text,0));
 select * into c from public.account_billing_analytics_consent where user_id=p_owner for update;
 if p_granted is not null then
  if p_operation is null or p_revision is null or p_revision<0 then raise exception 'Invalid choice' using errcode='22023'; end if;
  if c.operation_id=p_operation then
   if c.granted<>p_granted then raise exception 'Conflicting operation' using errcode='40001'; end if;
  else
   if coalesce(c.revision,0)<>p_revision then raise exception 'Stale choice' using errcode='40001'; end if;
   -- Repeating ON does not move the original consent boundary or create credentials.
   cid:=c.consent_id;
   if p_granted and not coalesce(c.granted,false) then
    cid:=gen_random_uuid();
    insert into public.analytics_consents(id,user_id,secret_hash,distinct_id)
    values(cid,p_owner,encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),p_owner::text);
   elsif not p_granted and cid is not null then
    perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||cid::text,0));
    update public.analytics_consents set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=cid;
    delete from public.analytics_outbox where consent_id=cid and state not in ('sending','sent');
   end if;
   insert into public.account_billing_analytics_consent(user_id,granted,granted_at,revision,operation_id,consent_id)
   values(p_owner,p_granted,case when p_granted then clock_timestamp() end,1,p_operation,cid)
   on conflict(user_id) do update set granted=excluded.granted,
    granted_at=case when excluded.granted and not account_billing_analytics_consent.granted then clock_timestamp()
      else account_billing_analytics_consent.granted_at end,
    updated_at=clock_timestamp(),revision=account_billing_analytics_consent.revision+1,operation_id=p_operation,consent_id=cid;
   select * into c from public.account_billing_analytics_consent where user_id=p_owner;
  end if;
 end if;
 return jsonb_build_object('owner',p_owner,'granted',coalesce(c.granted,false),'revision',coalesce(c.revision,0),
  'operationId',c.operation_id,'grantedAt',c.granted_at);
end $$;

-- Only the verified server adapter can call this. No device consent inference.
create function public.record_account_billing_analytics(p_owner uuid,p_provider text,p_environment text,p_subscription text,
 p_verified_at timestamptz,p_event text,p_key text,p_at timestamptz,p_properties jsonb,p_observed_after timestamptz default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.account_billing_analytics_consent; credential public.analytics_consents;
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
  p_verified_at,p_event,p_key,p_at,p_properties);
end $$;

alter function public.account_export_dataset(uuid) rename to account_export_dataset_before_billing_choice;
create function public.account_export_dataset(p_user_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_set(public.account_export_dataset_before_billing_choice(p_user_id),'{sections,billingAnalyticsChoice}',
 coalesce((select jsonb_agg(jsonb_build_object('granted',granted,'grantedAt',granted_at,'updatedAt',updated_at,'revision',revision))
 from public.account_billing_analytics_consent where user_id=p_user_id),'[]'::jsonb))
$$;
revoke all on function public.account_export_dataset(uuid),public.account_export_dataset_before_billing_choice(uuid) from public,anon,authenticated,service_role;
revoke all on function public.billing_analytics_choice(uuid,boolean,integer,uuid),public.record_account_billing_analytics(uuid,text,text,text,timestamptz,text,text,timestamptz,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.billing_analytics_choice(uuid,boolean,integer,uuid),public.record_account_billing_analytics(uuid,text,text,text,timestamptz,text,text,timestamptz,jsonb,timestamptz) to service_role;
commit;
