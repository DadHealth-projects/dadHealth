import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('native subscription schema and manual-grant migration are additive', async () => {
  const [schema, foundation] = await Promise.all([
    source('supabase/schema.sql'),
    source('supabase/migrations/20261017090000_manual_pro_grant_foundation.sql'),
  ]);
  assert.match(schema, /create table if not exists public\.subscription_entitlements/);
  assert.match(schema, /create table if not exists public\.subscription_account_links/);
  assert.match(schema, /create table if not exists public\.subscription_provider_events/);
  assert.match(schema, /create table if not exists public\.subscription_verification_rate_limits/);
  assert.match(schema, /add column if not exists is_pro boolean not null default false/);
  assert.match(foundation, /add column if not exists manual_pro_grant boolean not null default false/);
});

test('billing compatibility fields and entitlement records are server managed', async () => {
  const [foundation, schema] = await Promise.all([
    source('supabase/migrations/20261017090000_manual_pro_grant_foundation.sql'),
    source('supabase/schema.sql'),
  ]);
  for (const field of ['is_pro', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status']) {
    assert.ok(foundation.includes(field), `Missing protected profile field ${field}`);
  }
  assert.match(foundation, /new\.manual_pro_grant is distinct from old\.manual_pro_grant/);
  for (const table of [
    'subscription_entitlements',
    'subscription_account_links',
    'subscription_provider_events',
    'subscription_verification_rate_limits',
  ]) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(schema, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
  }
  assert.match(schema, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(schema, /Subscription already belongs to another user/);
});

test('entitlement and lifecycle claims remain concurrency safe and idempotent', async () => {
  const migration = await source('supabase/migrations/20260820120000_native_subscriptions.sql');
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('subscription:' \|\| p_user_id::text, 0\)\)/);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*'subscription-event:' \|\| p_provider \|\| ':' \|\| p_event_id/);
  assert.match(migration, /unique \(provider, provider_subscription_id\)/);
  assert.match(migration, /unique \(provider, event_id\)/);
  assert.match(migration, /current_status = 'completed'/);
  assert.match(migration, /current_claimed_at > now\(\) - interval '10 minutes'/);
});

test('native verification uses store signatures, account binding and server-side rate limiting', async () => {
  const [apple, google, appleRoute, googleRoute, rateLimit] = await Promise.all([
    source('src/lib/native-subscriptions/apple.ts'),
    source('src/lib/native-subscriptions/google.ts'),
    source('src/app/api/native-subscriptions/verify/apple/route.ts'),
    source('src/app/api/native-subscriptions/verify/google/route.ts'),
    source('src/lib/native-subscriptions/rate-limit.ts'),
  ]);
  assert.match(apple, /SignedDataVerifier/);
  assert.match(apple, /DAD_HEALTH_BUNDLE_ID/);
  assert.match(appleRoute, /appAccountToken/);
  assert.match(google, /androidpublisher/);
  assert.match(google, /createHmac\("sha256"/);
  assert.match(googleRoute, /obfuscatedExternalAccountId/);
  assert.match(rateLimit, /consume_subscription_verification_rate_limit/);
  assert.doesNotMatch(`${appleRoute}\n${googleRoute}`, /SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY/);
});

test('Apple and Google lifecycle notification routes claim events before applying updates', async () => {
  const [apple, google] = await Promise.all([
    source('src/app/api/native-subscriptions/notifications/apple/route.ts'),
    source('src/app/api/native-subscriptions/notifications/google/route.ts'),
  ]);
  for (const route of [apple, google]) {
    const claim = route.indexOf('claimProviderEvent');
    const upsert = route.lastIndexOf('upsertSubscriptionEntitlement');
    const complete = route.lastIndexOf('completeProviderEvent');
    assert.ok(claim >= 0 && upsert > claim && complete > upsert);
    assert.match(route, /failProviderEvent/);
  }
  assert.match(apple, /verifyAppleNotification/);
  assert.match(google, /verifyGoogleRtdnIdentity/);
});

test('Google RTDN orders verified snapshots by server verification time, not message publish time', async () => {
  const route = await source('src/app/api/native-subscriptions/notifications/google/route.ts');
  const verifiedPurchase = route.indexOf('const purchase = await verifyGooglePurchase(purchaseToken)');
  const savedSnapshot = route.indexOf('entitlement.lastVerifiedAt = verificationStartedAt');
  assert.ok(route.indexOf('const verificationStartedAt = new Date().toISOString()') < verifiedPurchase);
  assert.ok(savedSnapshot > verifiedPurchase);
  assert.doesNotMatch(route, /publishTime|publishedAt/);
});

test('Google verified purchase state maps renewal, cancellation and expiry from current Play data', async () => {
  const google = await source('src/lib/native-subscriptions/google.ts');
  assert.match(google, /case "SUBSCRIPTION_STATE_ACTIVE":[\s\S]*return trialing \? "trialing" : "active"/);
  assert.match(google, /case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":[\s\S]*return "grace_period"/);
  assert.match(google, /case "SUBSCRIPTION_STATE_CANCELED":[\s\S]*expiry > now \? "active" : "canceled"/);
  assert.match(google, /case "SUBSCRIPTION_STATE_EXPIRED":[\s\S]*return "expired"/);
  assert.match(google, /currentPeriodEnd: lineItem\.expiryTime \?\? null/);
});

test('existing Stripe profile sync mirrors lifecycle into the provider-neutral ledger', async () => {
  const sync = await source('src/lib/stripe/sync-user-profile.ts');
  assert.match(sync, /provider: "stripe"/);
  assert.match(sync, /upsertSubscriptionEntitlement/);
  assert.match(sync, /stripe_subscription_id/);
  assert.match(sync, /subscription_status/);
  assert.doesNotMatch(sync, /from\("user_profile"\)|\.update\(|\.insert\(/);
});

test('Stripe profile writes share the serialized entitlement transaction', async () => {
  const [sync, migration, preflight] = await Promise.all([
    source('src/lib/stripe/sync-user-profile.ts'),
    source('supabase/migrations/20261017110000_atomic_stripe_profile_sync.sql'),
    source('supabase/operations/stripe_profile_trigger_preflight.sql'),
  ]);
  const upsert = migration.slice(migration.indexOf('create or replace function public.upsert_subscription_entitlement'));
  const refresh = migration.slice(migration.indexOf('create or replace function public.refresh_effective_subscription_profile'));
  assert.match(sync, /await upsertSubscriptionEntitlement/);
  assert.doesNotMatch(sync, /user_profile|\.update\(|\.insert\(/);
  assert.match(upsert, /pg_advisory_xact_lock\(hashtextextended\('subscription:' \|\| p_user_id::text, 0\)\)/);
  assert.match(upsert, /excluded\.last_verified_at > current_entitlement\.last_verified_at/);
  assert.match(upsert, /Verified subscription expiry is required for Pro access/);
  assert.match(refresh, /update public\.user_profile[\s\S]*subscription_status = compatibility_status[\s\S]*stripe_customer_id[\s\S]*stripe_subscription_id/);
  assert.match(migration, /after insert or update or delete on public\.subscription_entitlements/);
  assert.match(preflight, /pg_get_triggerdef/);
  assert.match(preflight, /pg_get_functiondef/);
  assert.doesNotMatch(preflight, /\b(insert|update|delete|alter|create)\s/i);
});

test('entitlement and profile snapshots serialize together and reject stale webhook times', async () => {
  const [migration, schema] = await Promise.all([
    source('supabase/migrations/20261017110000_atomic_stripe_profile_sync.sql'),
    source('supabase/schema.sql'),
  ]);
  const upsert = migration.slice(migration.indexOf('create or replace function public.upsert_subscription_entitlement'));
  const profileSync = migration.slice(migration.indexOf('create or replace function public.refresh_effective_subscription_profile'));
  assert.match(upsert, /pg_advisory_xact_lock\(hashtextextended\('subscription:' \|\| p_user_id::text, 0\)\)/);
  assert.match(upsert, /excluded\.last_verified_at > current_entitlement\.last_verified_at/);
  assert.match(upsert, /Verified subscription expiry is required for Pro access/);
  assert.match(profileSync, /stripe_customer_id = case/);
  assert.match(profileSync, /stripe_subscription_id = case/);
  assert.match(profileSync, /subscription_status = compatibility_status/);
  assert.match(schema, /excluded\.last_verified_at > current_entitlement\.last_verified_at/);
  assert.match(migration, /create or replace function public\.refresh_effective_subscription_profile/);
  assert.match(migration, /refresh_subscription_profile_after_entitlement/);
});

test('the shared Pro summary delegates its decision to the database entitlement predicate', async () => {
  const [store, predicate] = await Promise.all([
    source('src/lib/native-subscriptions/store.ts'),
    source('supabase/migrations/20261017100000_pro_saved_content_access.sql'),
  ]);
  assert.match(store, /rpc\("user_has_pro_access"/);
  assert.match(store, /canonicalProAccess === true/);
  const resolver = predicate.slice(predicate.indexOf('create or replace function public.user_has_pro_access'), predicate.indexOf('revoke all on function public.user_has_pro_access'));
  assert.match(resolver, /profile\.manual_pro_grant/);
  assert.match(resolver, /status in \('active', 'trialing', 'grace_period'\)/);
  assert.match(resolver, /current_period_end is not null[\s\S]*current_period_end > now\(\)/);
  assert.doesNotMatch(resolver, /profile\.is_pro|profile\.stripe_customer_id/);
});

test('legacy Pro flags are preflighted and provider snapshots cannot go backwards', async () => {
  const [foundation, accessMigration, auditQuery, schema] = await Promise.all([
    source('supabase/migrations/20261017090000_manual_pro_grant_foundation.sql'),
    source('supabase/migrations/20261017100000_pro_saved_content_access.sql'),
    source('supabase/operations/pro_entitlement_preflight.sql'),
    source('supabase/schema.sql'),
  ]);
  assert.match(foundation, /manual_pro_grant boolean not null default false/);
  assert.match(foundation, /new\.manual_pro_grant is distinct from old\.manual_pro_grant/);
  assert.match(accessMigration, /profile\.is_pro[\s\S]*profile\.manual_pro_grant/);
  assert.match(accessMigration, /current_period_end is null[\s\S]*raise exception/);
  assert.match(auditQuery, /CLASSIFY_LEGACY_PRO_FLAG/);
  assert.match(schema, /excluded\.last_verified_at > current_entitlement\.last_verified_at/);
});

test('web subscription presentation uses the same canonical server summary', async () => {
  const route = await source('src/app/api/stripe/subscription/route.ts');
  assert.match(route, /getSubscriptionSummary\(createAdminSupabaseClient\(\), user\.id\)/);
  assert.doesNotMatch(route, /stripe\.subscriptions\.(retrieve|list)/);
});
