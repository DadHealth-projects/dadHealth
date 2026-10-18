-- Read-only production preflight for the canonical Pro resolver migration.
-- Review every returned row before running the manual classification procedure.
with effective_provider_access as (
  select
    entitlement.user_id,
    bool_or(
      entitlement.status in ('active', 'trialing', 'grace_period')
      and entitlement.current_period_end > now()
    ) as has_valid_provider_access,
    bool_or(
      entitlement.status in ('active', 'trialing', 'grace_period')
      and entitlement.current_period_end is null
    ) as has_missing_expiry,
    jsonb_agg(jsonb_build_object(
      'provider', entitlement.provider,
      'status', entitlement.status,
      'current_period_end', entitlement.current_period_end,
      'last_verified_at', entitlement.last_verified_at
    ) order by entitlement.updated_at desc) as subscriptions
  from public.subscription_entitlements entitlement
  group by entitlement.user_id
)
select
  profile.user_id,
  profile.is_pro as legacy_is_pro,
  profile.manual_pro_grant,
  profile.stripe_customer_id is not null as has_stripe_customer,
  profile.stripe_subscription_id is not null as has_stripe_subscription_id,
  profile.subscription_status as legacy_subscription_status,
  coalesce(provider.has_valid_provider_access, false) as has_valid_provider_access,
  coalesce(provider.has_missing_expiry, false) as has_missing_expiry,
  provider.subscriptions,
  case
    when coalesce(provider.has_missing_expiry, false) then 'RECONCILE_PROVIDER_EXPIRY'
    when profile.stripe_subscription_id is not null and provider.user_id is null then 'RECONCILE_STRIPE_SUBSCRIPTION'
    when profile.is_pro and not profile.manual_pro_grant
      and not coalesce(provider.has_valid_provider_access, false) then 'CLASSIFY_LEGACY_PRO_FLAG'
    when profile.stripe_customer_id is not null
      and profile.subscription_status in ('active', 'trialing')
      and not coalesce(provider.has_valid_provider_access, false) then 'RECONCILE_LEGACY_STRIPE_STATUS'
    else 'READY'
  end as migration_review
from public.user_profile profile
left join effective_provider_access provider on provider.user_id = profile.user_id
where profile.is_pro
   or profile.manual_pro_grant
   or profile.stripe_customer_id is not null
   or profile.stripe_subscription_id is not null
   or profile.subscription_status in ('active', 'trialing', 'grace_period')
   or provider.user_id is not null;
