import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('native subscription migration is additive and mirrored in committed schema', async () => {
  const [schema, migration] = await Promise.all([
    source('supabase/schema.sql'),
    source('supabase/migrations/20260820120000_native_subscriptions.sql'),
  ]);
  const body = migration.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '').trim();
  assert.ok(schema.includes(body), 'The committed schema must contain the exact native subscription migration body');
  assert.match(migration, /alter table public\.user_profile\s+add column if not exists is_pro/);
  assert.match(migration, /create table if not exists public\.subscription_entitlements/);
  assert.match(migration, /create table if not exists public\.subscription_account_links/);
  assert.match(migration, /create table if not exists public\.subscription_provider_events/);
  assert.match(migration, /create table if not exists public\.subscription_verification_rate_limits/);
});

test('billing compatibility fields and entitlement records are server managed', async () => {
  const migration = await source('supabase/migrations/20260820120000_native_subscriptions.sql');
  for (const field of ['is_pro', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status']) {
    assert.ok(migration.includes(field), `Missing protected profile field ${field}`);
  }
  for (const table of [
    'subscription_entitlements',
    'subscription_account_links',
    'subscription_provider_events',
    'subscription_verification_rate_limits',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
  }
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /Subscription already belongs to another user/);
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

test('existing Stripe profile sync mirrors lifecycle into the provider-neutral ledger', async () => {
  const sync = await source('src/lib/stripe/sync-user-profile.ts');
  assert.match(sync, /provider: "stripe"/);
  assert.match(sync, /upsertSubscriptionEntitlement/);
  assert.match(sync, /stripe_subscription_id/);
  assert.match(sync, /subscription_status/);
});
