import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../src/app/api/generate-meal-plan/route.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261017100000_pro_saved_content_access.sql', import.meta.url), 'utf8');
const rls = await readFile(new URL('../supabase/rls-policies.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const subscriptionStore = await readFile(new URL('../src/lib/native-subscriptions/store.ts', import.meta.url), 'utf8');
const stripeSync = await readFile(new URL('../src/lib/stripe/sync-user-profile.ts', import.meta.url), 'utf8');
const stripeWebhook = await readFile(new URL('../src/app/api/stripe/webhook/route.ts', import.meta.url), 'utf8');
const dadDays = await readFile(new URL('../src/app/api/dad_days_searches/route.ts', import.meta.url), 'utf8');

test('saved meal plan API checks canonical access before returning service-role data', () => {
  const getHandler = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.match(getHandler, /getSubscriptionSummary\(createAdminSupabaseClient\(\), user\.id\)/);
  assert.match(getHandler, /if \(!isPro\)[\s\S]*?status: 403/);
  assert.ok(getHandler.indexOf('if (!isPro)') < getHandler.indexOf(".from('meal_plans')"));
});

test('RLS locks only AI-generated plans and templates, preserving Free weekly content and user deletion', () => {
  assert.match(migration, /source = 'ai_generated'[\s\S]*?current_user_has_pro_access\(\)/);
  assert.match(migration, /source is distinct from 'ai_generated' or public\.current_user_has_pro_access\(\)/);
  assert.match(migration, /Users can delete own meal plans[\s\S]*?using \(auth\.uid\(\) = user_id\)/);
  assert.match(migration, /source = 'admin'[\s\S]*?free_weekly_workout_assignments/);
  assert.doesNotMatch(migration, /delete from public\.(workouts|meal_plans|workout_sessions)/i);
  assert.match(rls, /source = 'ai_generated'[\s\S]*?current_user_has_pro_access\(\)/);
});

test('SQL regression suite covers Free, Pro, Trial, paid-through cancellation, expiry, renewal and preservation', async () => {
  const sql = await readFile(new URL('../supabase/tests/saved_pro_content_access.test.sql', import.meta.url), 'utf8');
  for (const state of ['Free user', 'active Pro', 'Trial', 'cancelled subscription retains access through paid period', 'expired user', 'renewed user']) {
    assert.ok(sql.includes(state), `missing ${state} coverage`);
  }
  assert.match(sql, /completed workout history remains stored/);
  assert.match(sql, /Free can delete own inaccessible saved plan/);
  assert.match(sql, /expired user with legacy is_pro=true/);
  assert.match(sql, /manual grant without subscription/);
  assert.match(sql, /older provider update cannot overwrite newer Pro state/);
  assert.match(sql, /provider cannot write active access without expiry/);
});

test('manual grants, provider expiry and provider refresh use one canonical entitlement path', async () => {
  const resolver = migration.slice(migration.indexOf('create or replace function public.user_has_pro_access'), migration.indexOf('revoke all on function public.user_has_pro_access'));
  assert.match(resolver, /profile\.manual_pro_grant/);
  assert.match(resolver, /current_period_end is not null[\s\S]*current_period_end > now\(\)/);
  assert.doesNotMatch(resolver, /profile\.is_pro/);
  assert.match(schema, /new\.manual_pro_grant is distinct from old\.manual_pro_grant/);
  assert.match(subscriptionStore, /profile\.manual_pro_grant/);
  assert.match(subscriptionStore, /canonicalProAccess === true/);
  assert.doesNotMatch(subscriptionStore, /legacyStripeAccess|select\("manual_pro_grant, subscription_status/);
  assert.match(stripeSync, /currentPeriodEnd: fields\.current_period_end/);
  assert.match(stripeWebhook, /stripe\.subscriptions\.retrieve\(eventSubscription\.id\)/);
  assert.match(stripeWebhook, /current_period_end: new Date\(sub\.current_period_end \* 1000\)\.toISOString\(\)/);
  assert.match(dadDays, /getSubscriptionSummary\(supabaseAdmin, userId\)/);
  assert.doesNotMatch(dadDays, /profileHasProAccess|\.select\('is_pro, subscription_status'\)/);
});

test('provider update timestamps are ordered across Apple and Google notifications', async () => {
  const [appleNotification, googleNotification] = await Promise.all([
    readFile(new URL('../src/app/api/native-subscriptions/notifications/apple/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/api/native-subscriptions/notifications/google/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /excluded\.last_verified_at >= current_entitlement\.last_verified_at/);
  assert.match(appleNotification, /notification as typeof verified\.notification & \{ signedDate\?: number \}/);
  assert.match(googleNotification, /envelope\.message\.publishTime/);
  const appleVerify = await readFile(new URL('../src/app/api/native-subscriptions/verify/apple/route.ts', import.meta.url), 'utf8');
  assert.match(appleVerify, /existing\?\.status === "grace_period"/);
  assert.match(appleVerify, /existingGraceEnd > Date\.now\(\)/);
});

test('migration blocks unresolved legacy grants and missing provider expiry', () => {
  assert.match(migration, /Active subscription expiry dates are unresolved/);
  assert.match(migration, /Legacy Pro flags need manual-grant or stale-flag classification/);
  assert.match(migration, /Legacy Stripe status lacks verified unexpired provider data/);
});
