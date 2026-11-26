// Opt-in isolated proof of migration 20261126160000 (retention offer redemptions) and the
// cancellation outcome report on in-process PostgreSQL (PGlite). Never connects to any server.
//   npm i --no-save @electric-sql/pglite@0.2 && node --test tests/retentionOfferRedemptions.database.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* opt-in */ }
const skip = !PGlite && 'PGlite not installed (opt-in)';
const MIGRATION = readFileSync(new URL('../supabase/migrations/20261126160000_m3_retention_offer_redemptions.sql', import.meta.url), 'utf8');
const REPORT = readFileSync(new URL('../supabase/operations/cancellation_outcomes_report.sql', import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
const SA = '10000000-0000-4000-8000-00000000000a', SB = '10000000-0000-4000-8000-00000000000b';

async function fresh() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key);
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.subscription_entitlements(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
      provider text not null, provider_subscription_id text not null, unique (provider, provider_subscription_id), unique (id, user_id));
    -- Stand-in for the installed export chain: the real one returns {"sections": {...}}.
    create function public.account_export_dataset(p_user_id uuid) returns jsonb language sql stable security definer
      set search_path = pg_catalog, public as $$ select jsonb_build_object('sections', jsonb_build_object('existing', true)) $$;
    revoke all on function public.account_export_dataset(uuid) from public, anon, authenticated, service_role;
    create table public.subscription_cancellation_feedback(user_id uuid, request_id uuid, subscription_id uuid, reason text,
      details text, submitted_at timestamptz, retain_until timestamptz, primary key(user_id, request_id));
    create table public.subscription_cancellation_evidence(subscription_id uuid primary key, user_id uuid, source text,
      snapshot_verified_at timestamptz, scheduled_end_at timestamptz, recorded_at timestamptz default now());
    create table public.subscription_cancellation_confirmations(subscription_id uuid, user_id uuid, verified_at timestamptz,
      access_end timestamptz, recorded_at timestamptz default now(), evidence_kind text, primary key(subscription_id, verified_at));
    insert into auth.users values ('${A}'), ('${B}');
    insert into public.subscription_entitlements values ('${SA}', '${A}', 'apple', 'orig-a'), ('${SB}', '${B}', 'apple', 'orig-b');
    ${MIGRATION}`);
  return db;
}
async function role(db, name) {
  await db.exec(`reset role; select set_config('request.jwt.claim.role', '${name}', false);`);
  if (name !== 'postgres') await db.exec(`set role ${name}`);
}
const record = (db, owner, orig, tx, offer = 'retention_50_3m', env = 'production', source = 'store_notification') =>
  db.query('select public.record_retention_offer_redemption($1, $2, $3, $4, $5, $6, $7, $8, $9) v',
    [owner, 'apple', env, orig, tx, offer, 'pro.monthly', '2026-11-26T12:00:00Z', source]).then(r => r.rows[0].v);
const rows = async db => (await db.query('select user_id::text, subscription_id::text, transaction_id, source from public.subscription_retention_offer_redemptions order by transaction_id')).rows;

test('retention offer redemptions: owner-bound, idempotent, server-only, exported, deleted with the account', { skip }, async () => {
  const db = await fresh();
  for (const name of ['anon', 'authenticated']) {
    await role(db, name);
    await assert.rejects(record(db, A, 'orig-a', 't1'), /permission denied/, name);
    await assert.rejects(db.query('select * from public.subscription_retention_offer_redemptions'), /permission denied/, name);
  }
  await role(db, 'postgres');
  await db.exec("select set_config('request.jwt.claim.role', 'authenticated', false)");
  await assert.rejects(record(db, A, 'orig-a', 't1'), /Service role required/);

  await role(db, 'service_role');
  assert.deepEqual(await record(db, A, 'orig-a', 't1', undefined, undefined, 'verified_purchase'), { recorded: true });
  assert.deepEqual(await record(db, A, 'orig-a', 't1'), { recorded: false }, 'notification for the same transaction: idempotent');
  assert.deepEqual(await record(db, A, 'orig-a', 't2'), { recorded: true }, 'a later offer-period renewal is its own row');
  assert.deepEqual(await record(db, A, 'orig-a', 't1', 'retention_50_3m', 'sandbox'), { recorded: true }, 'environments are separate');
  await assert.rejects(record(db, B, 'orig-a', 't9'), /Subscription not found for this account/, 'another member cannot claim A\'s subscription');
  await assert.rejects(record(db, A, 'orig-a', 't1', 'winback'), /conflict/, 'same transaction, different offer');
  await assert.rejects(record(db, A, 'orig-missing', 't3'), /Subscription not found/);
  for (const bad of [[null, 'orig-a', 't4'], [A, '', 't4'], [A, 'orig-a', '']]) {
    await assert.rejects(record(db, ...bad), /Invalid retention offer redemption/);
  }
  await assert.rejects(record(db, A, 'orig-a', 't5', 'retention_50_3m', 'production', 'app_claim'), /Invalid/);
  await assert.rejects(record(db, A, 'orig-a', 't5', 'retention_50_3m', 'staging'), /Invalid/);
  await role(db, 'postgres');
  assert.deepEqual((await rows(db)).map(r => [r.user_id, r.subscription_id, r.transaction_id]),
    [[A, SA, 't1'], [A, SA, 't1'], [A, SA, 't2']]);
  assert.equal((await rows(db)).find(r => r.transaction_id === 't1').source !== undefined, true);

  // Export: the member's own rows only, alongside the existing sections.
  const exportA = (await db.query('select public.account_export_dataset($1) v', [A])).rows[0].v;
  const exportB = (await db.query('select public.account_export_dataset($1) v', [B])).rows[0].v;
  assert.equal(exportA.sections.existing, true, 'previous export kept underneath');
  assert.equal(exportA.sections.retentionOfferRedemptions.length, 3);
  assert.deepEqual(Object.keys(exportA.sections.retentionOfferRedemptions[0]).sort(), ['offerIdentifier', 'productId', 'provider', 'purchasedAt', 'recordedAt']);
  assert.deepEqual(exportB.sections.retentionOfferRedemptions, []);
  const acl = (await db.query("select proname, coalesce(proacl::text, '') a from pg_proc where proname in ('account_export_dataset', 'account_export_dataset_before_offer_redemptions', 'record_retention_offer_redemption') order by 1")).rows;
  assert.doesNotMatch(acl.find(r => r.proname === 'account_export_dataset').a, /(anon|authenticated|service_role)=/);
  assert.doesNotMatch(acl.find(r => r.proname === 'record_retention_offer_redemption').a, /(^|[{,])(anon|authenticated)?=X/);

  // Account deletion removes the rows (cascade from auth.users).
  await db.exec(`delete from auth.users where id = '${A}'`);
  assert.equal((await rows(db)).length, 0);
  await db.close();
});

test('cancellation outcome report: offer_accepted only after the reason and only until a newer cancellation', { skip }, async () => {
  const db = await fresh();
  const users = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-0000000001${i}0`);
  for (const [i, u] of users.entries()) {
    await db.exec(`insert into auth.users values ('${u}'); insert into public.subscription_entitlements values ('${u}', '${u}', 'apple', 'o${i}');
      insert into public.subscription_cancellation_feedback values ('${u}', gen_random_uuid(), '${u}', 'too_expensive', null, '2026-11-26T10:00:00Z', null);`);
  }
  const offer = (i, at) => db.exec(`insert into public.subscription_retention_offer_redemptions(provider, environment, transaction_id,
    original_transaction_id, user_id, subscription_id, offer_identifier, product_id, purchased_at, source, recorded_at)
    values ('apple', 'production', 'tx${i}', 'o${i}', '${users[i]}', '${users[i]}', 'retention_50_3m', 'pro.monthly', '${at}', 'store_notification', '${at}')`);
  const evidence = (i, source, at) => db.exec(`insert into public.subscription_cancellation_evidence values ('${users[i]}', '${users[i]}', '${source}', '${at}', null)`);
  await offer(0, '2026-11-26T10:05:00Z');                                                   // took the offer
  await offer(1, '2026-11-26T10:05:00Z'); await evidence(1, 'apple_renewal_enabled', '2026-11-26T10:06:00Z'); // offer, renewal still on
  await offer(2, '2026-11-26T10:05:00Z'); await evidence(2, 'apple_renewal_disabled', '2026-11-27T09:00:00Z'); // offer, later cancelled
  await offer(3, '2026-11-25T09:00:00Z');                                                   // offer BEFORE the reason: not counted
  await evidence(4, 'apple_renewal_disabled', '2026-11-26T10:10:00Z');                      // cancelled, no offer
  //  user 5: gave a reason, nothing happened since
  await offer(6, '2026-11-26T10:05:00Z');                                                   // offer, then a verified cancellation confirmation
  await db.exec(`insert into public.subscription_cancellation_confirmations values ('${users[6]}', '${users[6]}', '2026-11-28T08:00:00Z', null, default, 'apple')`);
  const result = (await db.query(REPORT)).rows.map(r => `${r.outcome}:${r.members}`).sort();
  assert.deepEqual(result, ['cancelled:3', 'no_store_change:2', 'offer_accepted:2']);
  await db.close();
});
