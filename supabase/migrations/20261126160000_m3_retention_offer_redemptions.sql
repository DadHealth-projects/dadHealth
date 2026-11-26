-- Brief 01 / client audit A3: a durable record of the 50% retention offer being accepted.
--
-- One row per Apple transaction that carries our promotional offer (offerType 2 and the configured
-- offer identifier), written only by the server after Apple's signature was verified: from the
-- in-app purchase verification and from Apple's server notifications (Apple retries those until
-- they are acknowledged, so a lost app response cannot lose the record). Idempotent on Apple's
-- transaction id. The owner's subscription is resolved here from the verified subscription row,
-- so a record can never be attached to another member's subscription.
--
-- Nothing here switches the offer on: signing stays off until the store offer and key are set
-- (APPLE_IAP_RETENTION_* in Vercel). Once-per-member enforcement is a pending client decision
-- (H2c); this table is what that rule would read. No free text, no analytics event.
-- Privacy: rows cascade with the account (auth.users) and are included in the account export.
-- Rollback (only while the table is empty or its rows may be discarded): see
-- sql_editor_steps/12_retention_offer_redemptions.sql section 5.

create table if not exists public.subscription_retention_offer_redemptions (
  provider text not null check (provider = 'apple'),
  environment text not null check (environment in ('production', 'sandbox')),
  transaction_id text not null check (length(transaction_id) between 1 and 128),
  original_transaction_id text not null check (length(original_transaction_id) between 1 and 128),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null,
  offer_identifier text not null check (length(offer_identifier) between 1 and 64),
  product_id text not null check (length(product_id) between 1 and 128),
  purchased_at timestamptz,
  source text not null check (source in ('verified_purchase', 'store_notification')),
  recorded_at timestamptz not null default now(),
  primary key (provider, environment, transaction_id),
  foreign key (subscription_id, user_id) references public.subscription_entitlements(id, user_id) on delete cascade
);
create index if not exists subscription_retention_offer_redemptions_owner
  on public.subscription_retention_offer_redemptions (user_id, recorded_at desc);
create index if not exists subscription_retention_offer_redemptions_subscription
  on public.subscription_retention_offer_redemptions (subscription_id, user_id);
alter table public.subscription_retention_offer_redemptions enable row level security;
revoke all on table public.subscription_retention_offer_redemptions from public, anon, authenticated;
comment on table public.subscription_retention_offer_redemptions is
  'Apple-verified transactions that used the configured retention offer. Server-only; written by record_retention_offer_redemption.';

create or replace function public.record_retention_offer_redemption(
  p_user_id uuid, p_provider text, p_environment text, p_original_transaction_id text, p_transaction_id text,
  p_offer_identifier text, p_product_id text, p_purchased_at timestamptz, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_subscription uuid;
  v_inserted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_provider is distinct from 'apple' or p_environment not in ('production', 'sandbox')
     or nullif(p_original_transaction_id, '') is null or nullif(p_transaction_id, '') is null
     or nullif(p_offer_identifier, '') is null or nullif(p_product_id, '') is null
     or p_source not in ('verified_purchase', 'store_notification') then
    raise exception 'Invalid retention offer redemption' using errcode = '22023';
  end if;
  -- Only the owner's own verified subscription (saved by the same request, just before this call).
  select e.id into v_subscription from public.subscription_entitlements e
   where e.provider = p_provider and e.provider_subscription_id = p_original_transaction_id and e.user_id = p_user_id;
  if v_subscription is null then
    raise exception 'Subscription not found for this account' using errcode = 'P0002';
  end if;
  insert into public.subscription_retention_offer_redemptions(provider, environment, transaction_id, original_transaction_id,
    user_id, subscription_id, offer_identifier, product_id, purchased_at, source)
  values (p_provider, p_environment, p_transaction_id, p_original_transaction_id,
    p_user_id, v_subscription, p_offer_identifier, p_product_id, p_purchased_at, p_source)
  on conflict (provider, environment, transaction_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 and not exists (select 1 from public.subscription_retention_offer_redemptions r
      where r.provider = p_provider and r.environment = p_environment and r.transaction_id = p_transaction_id
        and r.user_id = p_user_id and r.subscription_id = v_subscription and r.offer_identifier = p_offer_identifier) then
    -- The same Apple transaction can never describe a different owner, subscription or offer.
    raise exception 'Retention offer redemption conflict' using errcode = '23505';
  end if;
  return jsonb_build_object('recorded', v_inserted = 1);
end;
$function$;
revoke all on function public.record_retention_offer_redemption(uuid, text, text, text, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_retention_offer_redemption(uuid, text, text, text, text, text, text, timestamptz, text)
  to service_role;

-- Account export: add the member's own redemptions as one more section (same wrapper pattern as
-- 20261120140000; the previous export is kept intact underneath).
alter function public.account_export_dataset(uuid) rename to account_export_dataset_before_offer_redemptions;
create function public.account_export_dataset(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
select jsonb_set(public.account_export_dataset_before_offer_redemptions(p_user_id), '{sections,retentionOfferRedemptions}',
  coalesce((select jsonb_agg(jsonb_build_object('provider', r.provider, 'offerIdentifier', r.offer_identifier,
      'productId', r.product_id, 'purchasedAt', r.purchased_at, 'recordedAt', r.recorded_at)
    order by r.recorded_at, r.transaction_id)
   from public.subscription_retention_offer_redemptions r where r.user_id = p_user_id), '[]'::jsonb));
$$;
revoke all on function public.account_export_dataset(uuid) from public, anon, authenticated, service_role;
