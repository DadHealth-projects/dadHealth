-- Read-only production check. Run in Supabase SQL Editor before considering
-- 20261017110000_atomic_stripe_profile_sync.sql. This does not change data.
with target as (
  select to_regclass('public.subscription_entitlements') as table_oid
), installed_triggers as (
  select trigger_row.*
  from pg_trigger trigger_row
  join target on trigger_row.tgrelid = target.table_oid
  where not trigger_row.tgisinternal
)
select
  target.table_oid is not null as entitlement_table_exists,
  coalesce(bool_or(installed_triggers.tgname = 'refresh_subscription_profile_after_entitlement'), false)
    as expected_trigger_exists,
  coalesce(jsonb_agg(jsonb_build_object(
    'name', installed_triggers.tgname,
    'enabled_state', installed_triggers.tgenabled,
    'trigger_definition', pg_get_triggerdef(installed_triggers.oid, true),
    'function_definition', pg_get_functiondef(installed_triggers.tgfoid)
  )) filter (where installed_triggers.oid is not null), '[]'::jsonb)
    as all_entitlement_triggers
from target
left join installed_triggers on true
group by target.table_oid;

-- Show exact deployed helper/upsert definitions and whether both functions exist.
select
  requested.signature,
  resolved.function_oid is not null as function_exists,
  case when resolved.function_oid is not null
    then pg_get_functiondef(resolved.function_oid)
  end as function_definition
from (values
  ('public.refresh_effective_subscription_profile(uuid)'),
  ('public.upsert_subscription_entitlement(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,timestamptz)')
) as requested(signature)
left join lateral (
  select to_regprocedure(requested.signature) as function_oid
) as resolved on true;
