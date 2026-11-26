// Opt-in isolated proof of migration 20261126170000 (billing transition journal), client audit A6,
// on in-process PostgreSQL (PGlite) with the real TypeScript drain. Never connects to any server.
//   npm i --no-save @electric-sql/pglite@0.2 && node --test tests/billingJournal.database.mjs
// Stand-ins (labelled): upsert_subscription_analytics_snapshot keeps its contract (newest verified
// state wins; returns id/previous/current/trialPeriod); record_account_billing_analytics keeps its
// contract (account choice must precede the event and its verification; idempotent event key;
// deletion suppresses). The journal, its functions and the drain are the real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* opt-in */ }
const skip = !PGlite && 'PGlite not installed (opt-in)';
const require = createRequire(import.meta.url);
const MIGRATION = readFileSync(new URL('../supabase/migrations/20261126170000_m3_billing_transition_journal.sql', import.meta.url), 'utf8');
const ON = { ANALYTICS_BILLING_COLLECTION_ENABLED: 'true', ANALYTICS_INGEST_ENABLED: 'true', ANALYTICS_PRIVACY_ENABLED: 'true' };
function load(path, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, process: { env: ON }, Date, AbortSignal, console: { warn() {} }, JSON, Array, Promise, require: id => id in mocks ? mocks[id] : require(id) });
  return exports;
}
const billing = load('src/lib/analytics/billing.ts', { './contract': load('src/lib/analytics/contract.ts') });
const A = '00000000-0000-4000-8000-00000000000a', SUB = '20000000-0000-4000-8000-00000000000a';

async function fresh() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.subscription_entitlements(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
      provider text, provider_subscription_id text, environment text, status text, auto_renews boolean, trial_end timestamptz,
      current_period_end timestamptz, last_verified_at timestamptz, provider_account_id text, unique(id, user_id), unique(provider, provider_subscription_id));
    create table public.account_deletion_tombstones(user_id uuid primary key);
    -- Stand-in with the real contract: newest verified state wins; returns previous/current.
    create function public.upsert_subscription_analytics_snapshot(p_snapshot jsonb, p_evidence jsonb) returns jsonb language plpgsql as $$
    declare prior public.subscription_entitlements; accepted public.subscription_entitlements;
    begin
      if p_snapshot->>'p_status' = 'explode' then raise exception 'save failed'; end if;
      select * into prior from public.subscription_entitlements where provider=p_snapshot->>'p_provider' and provider_subscription_id=p_snapshot->>'p_provider_subscription_id';
      if prior.id is null then
        insert into public.subscription_entitlements values ('${SUB}', (p_snapshot->>'p_user_id')::uuid, p_snapshot->>'p_provider',
          p_snapshot->>'p_provider_subscription_id', p_snapshot->>'p_environment', p_snapshot->>'p_status', (p_snapshot->>'p_auto_renews')::boolean,
          null, (p_snapshot->>'p_current_period_end')::timestamptz, (p_snapshot->>'p_last_verified_at')::timestamptz, 'cus_private');
      elsif (p_snapshot->>'p_last_verified_at')::timestamptz > prior.last_verified_at then
        update public.subscription_entitlements set status=p_snapshot->>'p_status', auto_renews=(p_snapshot->>'p_auto_renews')::boolean,
          current_period_end=(p_snapshot->>'p_current_period_end')::timestamptz, last_verified_at=(p_snapshot->>'p_last_verified_at')::timestamptz where id=prior.id;
      end if;
      select * into accepted from public.subscription_entitlements where provider=p_snapshot->>'p_provider' and provider_subscription_id=p_snapshot->>'p_provider_subscription_id';
      return jsonb_build_object('id', accepted.id, 'previous', case when prior.id is null then null else to_jsonb(prior) end,
        'current', to_jsonb(accepted), 'trialPeriod', null);
    end $$;
    create table public.account_billing_analytics_consent(user_id uuid primary key, granted boolean, granted_at timestamptz);
    create table public.recorded_billing(key text primary key, owner uuid, event text, at timestamptz);
    -- Stand-in with the real contract: choice must precede event and verification; key is idempotent.
    create function public.record_account_billing_analytics(p_owner uuid, p_provider text, p_environment text, p_subscription text,
      p_verified_at timestamptz, p_event text, p_key text, p_at timestamptz, p_properties jsonb, p_observed_after timestamptz default null)
    returns boolean language plpgsql security definer as $$
    declare c public.account_billing_analytics_consent;
    begin
      if exists (select 1 from public.account_deletion_tombstones where user_id = p_owner) then return false; end if;
      select * into c from public.account_billing_analytics_consent where user_id = p_owner;
      if not found or not c.granted or p_at < c.granted_at or p_verified_at < c.granted_at then return false; end if;
      if p_event like '%cancelled' and (p_observed_after is null or p_observed_after < c.granted_at) then return false; end if;
      insert into public.recorded_billing values (p_key, p_owner, p_event, p_at) on conflict do nothing;
      return found;
    end $$;
    insert into auth.users values ('${A}');
    ${MIGRATION}`);
  return db;
}
async function asService(db) { await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false); set role service_role;"); }
async function asOwner(db) { await db.exec('reset role;'); }
/** supabase-js-shaped client over PGlite: named arguments, thenable with abortSignal(). */
function client(db) {
  return { rpc(name, params) {
    const keys = Object.keys(params);
    const run = (async () => {
      try {
        const sql = `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
        const values = keys.map(k => params[k] !== null && typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]);
        const r = await db.query(sql, values);
        const fn = r.fields.length === 1 && r.fields[0].name === name;
        return { data: fn ? r.rows[0]?.[name] ?? null : r.rows, error: null };
      } catch (e) { return { data: null, error: { code: e.code ?? 'XX000', message: 'private' } }; }
    })();
    return { abortSignal: () => run, then: (a, b) => run.then(a, b) };
  } };
}
const snapshot = (at, over = {}) => ({ p_user_id: A, p_provider: 'apple', p_provider_subscription_id: 'orig', p_environment: 'sandbox',
  p_status: 'active', p_auto_renews: true, p_current_period_end: '2026-12-20T00:00:00Z', p_last_verified_at: at, ...over });
const observation = (over = {}) => ({ status: 'active', autoRenews: true, latestTransactionId: 'tx', trialEnd: null, trialFacts: null, verifiedPayment: null, ...over });
const save = (db, at, snapOver = {}, obsOver = {}) => db.query('select public.upsert_subscription_with_billing_journal($1, null, $2) v',
  [JSON.stringify(snapshot(at, snapOver)), JSON.stringify(observation(obsOver))]).then(r => r.rows[0].v);
const journal = async db => { await asOwner(db); const r = (await db.query('select verified_at, attempts, previous, observed from public.billing_analytics_transitions order by verified_at')).rows; await asService(db); return r; };
const recorded = async db => { await asOwner(db); const r = (await db.query('select event, at from public.recorded_billing order by at')).rows; await asService(db); return r; };

test('billing journal: a crash after the verified save cannot lose the transition; replay, order, consent and deletion hold', { skip }, async () => {
  const db = await fresh();
  await db.exec(`insert into public.account_billing_analytics_consent values ('${A}', true, '2026-11-01T00:00:00Z')`);
  await asService(db);

  // 1. First save (no previous): journalled; 2. cancellation saved, then the process "crashes"
  // before anything is recorded; 3. a later update arrives, so the live row's previous state is
  // now already "auto-renew off" (the exact loss in the audit).
  assert.equal((await save(db, '2026-11-25T10:00:00Z')).journalFailed, false);
  const cancel = await save(db, '2026-11-26T10:00:00Z', { p_auto_renews: false }, { autoRenews: false });
  assert.ok(cancel.journalId, 'journalled in the same call');
  await save(db, '2026-11-27T10:00:00Z', { p_auto_renews: false }, { autoRenews: false });
  const rows = await journal(db);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].previous.auto_renews, true, 'the cancellation row kept its verified previous state');
  assert.equal(rows[1].previous.provider_account_id, undefined, 'only the fields needed for billing facts are journalled');
  assert.equal(rows[1].previous.last_verified_at.startsWith('2026-11-25'), true);

  // Recovery: the drain (real TypeScript) records exactly one cancellation at its original time.
  const first = await billing.drainBillingTransitions(client(db), A);
  assert.equal(first.processed, 3); assert.equal(first.failed, 0); assert.equal(first.collected, 1);
  assert.deepEqual((await recorded(db)).map(r => r.event), ['subscription_cancelled']);
  assert.equal(new Date((await recorded(db))[0].at).toISOString(), '2026-11-26T10:00:00.000Z');
  assert.equal((await journal(db)).length, 0, 'rows removed only after recording');

  // Replay: draining again, and re-saving an already accepted or older snapshot, adds nothing.
  assert.equal((await billing.drainBillingTransitions(client(db), A)).processed, 0);
  assert.equal((await save(db, '2026-11-27T10:00:00Z', { p_auto_renews: false }, { autoRenews: false })).journalId, null, 'same verification: not journalled again');
  assert.equal((await save(db, '2026-11-20T10:00:00Z', { p_auto_renews: true })).journalId, null, 'older (out of order) snapshot: not journalled');
  assert.equal((await journal(db)).length, 0);
  assert.equal((await recorded(db)).length, 1);

  // A failed record leaves the row for retry (attempts counted), then a later drain succeeds.
  await save(db, '2026-11-28T10:00:00Z', { p_auto_renews: true }, { autoRenews: true });
  await save(db, '2026-11-29T10:00:00Z', { p_auto_renews: false }, { autoRenews: false });
  await asOwner(db); await db.exec('alter function public.record_account_billing_analytics(uuid,text,text,text,timestamptz,text,text,timestamptz,jsonb,timestamptz) rename to record_off'); await asService(db);
  const failed = await billing.drainBillingTransitions(client(db), A);
  // The renewal-on row has no facts and completes; only the cancellation row waits for retry.
  assert.equal(failed.failed, 1); assert.equal((await journal(db)).length, 1);
  assert.equal((await journal(db))[0].attempts, 1);
  await asOwner(db); await db.exec('alter function public.record_off(uuid,text,text,text,timestamptz,text,text,timestamptz,jsonb,timestamptz) rename to record_account_billing_analytics'); await asService(db);
  const retried = await billing.drainBillingTransitions(client(db), A);
  assert.equal(retried.failed, 0); assert.equal((await journal(db)).length, 0);
  assert.equal((await recorded(db)).filter(r => r.event === 'subscription_cancelled').length, 2, 'the second cancellation, once');

  // A journal problem never fails the verified save; a failed save leaves no journal.
  const bad = await db.query('select public.upsert_subscription_with_billing_journal($1, null, $2) v',
    [JSON.stringify(snapshot('2026-11-30T10:00:00Z')), JSON.stringify({ ...observation(), private: 'x' })]).then(r => r.rows[0].v);
  assert.equal(bad.journalFailed, true); assert.ok(bad.id, 'subscription still saved');
  await asOwner(db);
  assert.equal((await db.query("select last_verified_at::text t from public.subscription_entitlements")).rows[0].t.startsWith('2026-11-30'), true);
  await asService(db);
  await assert.rejects(save(db, '2026-12-01T10:00:00Z', { p_status: 'explode' }), /save failed/);
  assert.equal((await journal(db)).length, 0, 'rolled back together');

  // Consent after the event: suppressed (no retrospective consent) and the row still completes.
  await asOwner(db); await db.exec(`update public.account_billing_analytics_consent set granted_at='2026-12-10T00:00:00Z'`); await asService(db);
  await save(db, '2026-12-02T10:00:00Z', { p_auto_renews: false }, { autoRenews: false });
  await save(db, '2026-12-03T10:00:00Z', { p_auto_renews: true }, { autoRenews: true });
  await save(db, '2026-12-04T10:00:00Z', { p_auto_renews: false }, { autoRenews: false });
  const before = (await recorded(db)).length;
  await billing.drainBillingTransitions(client(db), A);
  assert.equal((await recorded(db)).length, before, 'nothing recorded before the choice was made');
  assert.equal((await journal(db)).length, 0);

  // Unsent rows expire after 7 days; deletion removes rows and suppresses recording.
  await save(db, '2026-12-05T10:00:00Z', { p_auto_renews: true }, { autoRenews: true });
  await asOwner(db); await db.exec("update public.billing_analytics_transitions set created_at = clock_timestamp() - interval '8 days'"); await asService(db);
  assert.equal((await billing.drainBillingTransitions(client(db), A)).processed, 0);
  assert.equal((await journal(db)).length, 0, 'expired, never sent');
  await save(db, '2026-12-06T10:00:00Z', { p_auto_renews: false }, { autoRenews: false });
  await asOwner(db); await db.exec(`delete from auth.users where id='${A}'`);
  assert.equal((await db.query('select count(*)::int n from public.billing_analytics_transitions')).rows[0].n, 0, 'deleted with the account');

  // Privileges: client roles cannot read the journal or call its functions.
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(db.query('select * from public.billing_analytics_transitions'), /permission denied/, role);
    await assert.rejects(db.query('select public.complete_billing_analytics_transition(gen_random_uuid())'), /permission denied/, role);
    await assert.rejects(db.query("select * from public.pending_billing_analytics_transitions(null, 1)"), /permission denied/, role);
  }
  await db.exec("reset role; select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(db.query("select public.upsert_subscription_with_billing_journal('{}'::jsonb, null, null)"), /Forbidden/);
  await db.close();
});
