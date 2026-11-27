begin;

-- Optional analytics must not affect subscription entitlement saves.
create function public.guard_billing_journal_consent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock_shared(
    hashtextextended('account-privacy:' || new.user_id::text, 0)
  );

  perform pg_advisory_xact_lock(
    hashtextextended('analytics-billing:' || new.user_id::text, 0)
  );

  if exists (
    select 1
    from public.account_deletion_tombstones
    where user_id = new.user_id
  ) then
    return null;
  end if;

  if not exists (
    select 1
    from public.account_billing_analytics_consent
    where user_id = new.user_id
      and granted = true
      and granted_at is not null
      and granted_at <= new.verified_at
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_billing_journal_consent()
from public, anon, authenticated, service_role;

create trigger billing_journal_consent_guard
before insert on public.billing_analytics_transitions
for each row
execute function public.guard_billing_journal_consent();


-- Remove pending billing analytics when consent is withdrawn.
create function public.purge_withdrawn_billing_journal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.granted is not true then
    delete from public.billing_analytics_transitions
    where user_id = new.user_id;
  end if;

  return new;
end;
$$;

revoke all on function public.purge_withdrawn_billing_journal()
from public, anon, authenticated, service_role;

create trigger billing_journal_withdrawal_cleanup
after insert or update of granted
on public.account_billing_analytics_consent
for each row
execute function public.purge_withdrawn_billing_journal();

-- Remove pending analytics when account deletion begins.
create function public.purge_deleted_billing_journal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.billing_analytics_transitions
  where user_id = new.user_id;

  return new;
end;
$$;

revoke all on function public.purge_deleted_billing_journal()
from public, anon, authenticated, service_role;

create trigger billing_journal_deletion_cleanup
after insert on public.account_deletion_tombstones
for each row
execute function public.purge_deleted_billing_journal();

-- Remove previously stored entries without valid consent.
delete from public.billing_analytics_transitions j
where not exists (
  select 1
  from public.account_billing_analytics_consent c
  where c.user_id = j.user_id
    and c.granted = true
    and c.granted_at <= j.verified_at
)
or exists (
  select 1
  from public.account_deletion_tombstones t
  where t.user_id = j.user_id
);

create or replace function public.cleanup_account_privacy_retention() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  -- Independent billing journal expiry cleanup.
  delete from public.billing_analytics_transitions
  where created_at < clock_timestamp() - interval '7 days';

 delete from public.account_export_artifacts a where a.expires_at<=clock_timestamp()
 or exists(select 1 from public.account_deletion_tombstones t where t.user_id=a.user_id);
 delete from public.account_privacy_confirmations where expires_at<=clock_timestamp();
 delete from public.account_privacy_delivery_failures where created_at<clock_timestamp()-interval '30 days';
 delete from public.account_privacy_operations where completed_at<clock_timestamp()-interval '30 days'
 and state in ('completed','sent_for_delivery','delivery_failed','cancelled','failed');
 -- Required pending cleanup is never purged as though complete. Its worker
 -- records a terminal failure after bounded retries for operator intervention.
end $$;


-- Preserve existing export sections and include pending billing observations.
alter function public.account_export_dataset(uuid)
rename to account_export_dataset_before_billing_journal;

create function public.account_export_dataset(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $export$
  select jsonb_set(
    public.account_export_dataset_before_billing_journal(p_user_id),
    '{sections,pendingBillingAnalytics}',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'provider', j.provider,
          'environment', j.environment,
          'verifiedAt', j.verified_at,
          'previousStatus', j.previous->'status',
          'previousAutoRenews', j.previous->'auto_renews',
          'previousTrialEnd', j.previous->'trial_end',
          'previousPeriodEnd', j.previous->'current_period_end',
          'previousVerifiedAt', j.previous->'last_verified_at',
          'status', j.observed->'status',
          'autoRenews', j.observed->'autoRenews',
          'trialEnd', j.observed->'trialEnd',
          'trialPeriodEndsAt', j.observed->'trialPeriodEndsAt',
          'trialStartedAt', j.observed #> '{trialFacts,startedAt}',
          'trialEvidenceEndsAt', j.observed #> '{trialFacts,endsAt}',
          'paymentPaidAt', j.observed #> '{verifiedPayment,paidAt}',
          'paymentAmount', j.observed #> '{verifiedPayment,amount}',
          'paymentVerified', j.observed #> '{verifiedPayment,verified}',
          'paymentServicePeriodStart', j.observed #> '{verifiedPayment,servicePeriodStart}',
          'retentionOfferPurchasedAt', j.observed #> '{retentionOffer,purchasedAt}'
        )
        order by j.verified_at, j.id
      )
      from public.billing_analytics_transitions j
      where j.user_id = p_user_id
    ), '[]'::jsonb)
  );
$export$;

revoke all on function public.account_export_dataset_before_billing_journal(uuid)
from public, anon, authenticated, service_role;

revoke all on function public.account_export_dataset(uuid)
from public, anon, authenticated, service_role;

commit;
