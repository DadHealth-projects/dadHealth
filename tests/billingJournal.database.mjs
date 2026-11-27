// Opt-in isolated proof of migration 20261126170000 (billing transition journal; client audit
// A3/A6) on in-process PostgreSQL (PGlite) with the real TypeScript drain. Never connects to any
// server.   npm i --no-save @electric-sql/pglite@0.2 && node --test tests/billingJournal.database.mjs
// Real: the journal, its functions, record_account_billing_analytics and
// record_verified_billing_analytics as redefined by the migration, enqueue_analytics_fact
// (20261120130000) and the consent/outbox tables, all extracted from the migrations.
// Stand-in (labelled): upsert_subscription_analytics_snapshot keeps its contract (newest verified
// state wins; returns id/previous/current/trialPeriod).
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
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = process.env.BILLING_JOURNAL_MIGRATION ? readFileSync(process.env.BILLING_JOURNAL_MIGRATION, 'utf8')
  : read('20261126170000_m3_billing_transition_journal.sql');
const FOUNDATION = read('20261120120000_optional_analytics_foundation.sql');
const FUNNEL = read('20261120130000_analytics_funnel_facts.sql');
const CHOICE = read('20261126130000_account_billing_analytics_consent.sql');
const table = (sql, name) => { const m = new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`).exec(sql); assert.ok(m, name); return m[0]; };
function fn(sql, name) {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  const tag = /\bas\s+(\$[a-z_]*\$)/i.exec(sql.slice(start)); const body = start + tag.index + tag[0].length;
  return sql.slice(start, sql.indexOf(tag[1], body) + tag[1].length) + ';';
}
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
const ago = hours => new Date(Date.now() - hours * 3600e3).toISOString();

async function fresh() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.account_deletion_tombstones(user_id uuid primary key);
    create table public.subscription_entitlements(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
      provider text, provider_subscription_id text, environment text, status text, auto_renews boolean, trial_end timestamptz,
      current_period_end timestamptz, last_verified_at timestamptz, provider_account_id text, unique(id, user_id), unique(provider, provider_subscription_id));
    create table public.subscription_cancellation_feedback(user_id uuid, request_id uuid, subscription_id uuid, reason text,
      details text, submitted_at timestamptz, retain_until timestamptz, primary key(user_id, request_id));
    create table public.analytics_funnel_keys(user_id uuid, key text, primary key(user_id, key));
    ${table(FOUNDATION, 'analytics_consents')}
    ${table(FOUNDATION, 'analytics_outbox')}
    ${table(CHOICE, 'account_billing_analytics_consent')}
    ${fn(FUNNEL, 'enqueue_analytics_fact')}
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
    insert into auth.users values ('${A}');
    ${MIGRATION}`);
  return db;
}
async function asService(db) { await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false); set role service_role;"); }
/** supabase-js-shaped client over PGlite: named arguments, thenable with abortSignal(). */
function client(db) {
  return { rpc(name, params) {
    const keys = Object.keys(params);
    const run = (async () => {
      try {
        const r = await db.query(`select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`,
          keys.map(k => params[k] !== null && typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]));
        const scalar = r.fields.length === 1 && r.fields[0].name === name;
        return { data: scalar ? r.rows[0]?.[name] ?? null : r.rows, error: null };
      } catch (e) { return { data: null, error: { code: e.code ?? 'XX000', message: 'private' } }; }
    })();
    return { abortSignal: () => run, then: (a, b) => run.then(a, b) };
  } };
}
const snapshot = (at, over = {}) => ({ p_user_id: A, p_provider: 'apple', p_provider_subscription_id: 'orig', p_environment: 'sandbox',
  p_status: 'active', p_auto_renews: true, p_current_period_end: '2099-12-20T00:00:00Z', p_last_verified_at: at, ...over });
const observation = (over = {}) => ({ status: 'active', autoRenews: true, latestTransactionId: 'tx', trialEnd: null, trialFacts: null, verifiedPayment: null, ...over });
const save = (db, at, snapOver = {}, obsOver = {}) => db.query('select public.upsert_subscription_with_billing_journal($1, null, $2) v',
  [JSON.stringify(snapshot(at, snapOver)), JSON.stringify(observation(obsOver))]).then(r => r.rows[0].v);
async function owner(db, sql, params) { await db.exec('reset role;'); const r = (await db.query(sql, params)).rows; await asService(db); return r; }
const journal = db => owner(db, 'select verified_at, attempts, previous, observed from public.billing_analytics_transitions order by verified_at');
const outbox = db => owner(db, 'select event, occurred_at, properties from public.analytics_outbox order by occurred_at');
async function consentAt(db, at) {
  await owner(db, `insert into public.account_billing_analytics_consent(user_id, granted, granted_at, revision) values ($1, true, $2, 1)
    on conflict (user_id) do update set granted = true, granted_at = excluded.granted_at`, [A, at]);
}

test('billing journal + real recording chain: a crash after the save cannot lose the transition', { skip }, async () => {
  const db = await fresh(); await asService(db); await consentAt(db, ago(150));
  // First save; then the cancellation is saved and the process "crashes" before recording; then
  // a later update arrives, so the live row is no longer at the cancellation's verification.
  await save(db, ago(100));
  const cancelAt = ago(90);
  assert.ok((await save(db, cancelAt, { p_auto_renews: false }, { autoRenews: false })).journalId);
  const laterAt = ago(80);
  await save(db, laterAt, { p_auto_renews: false }, { autoRenews: false });
  const rows = await journal(db);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].previous.auto_renews, true, 'the cancellation row kept its verified previous state');
  assert.equal(rows[1].previous.provider_account_id, undefined, 'only billing-fact fields are journalled');

  const drained = await billing.drainBillingTransitions(client(db), A);
  assert.equal(drained.failed, 0); assert.equal(drained.processed, 3); assert.equal(drained.collected, 1);
  const events = await outbox(db);
  assert.deepEqual(events.map(e => e.event), ['subscription_cancelled'], 'recorded although no longer the latest verification');
  assert.equal(new Date(events[0].occurred_at).getTime(), new Date(cancelAt).getTime(), 'at its original verified time');
  assert.equal(events[0].properties.reason, 'unavailable', 'no feedback given: reason unavailable');
  assert.equal((await journal(db)).length, 0);

  // Replay and out-of-order saves add nothing; re-draining adds nothing.
  assert.equal((await save(db, laterAt, { p_auto_renews: false }, { autoRenews: false })).journalId, null, 'same verification replayed');
  assert.equal((await save(db, ago(120))).journalId, null);
  assert.equal((await billing.drainBillingTransitions(client(db), A)).processed, 0);
  assert.equal((await outbox(db)).length, 1);

  // Journal problem never fails the save; failed save leaves no journal (one transaction).
  const bad = await db.query('select public.upsert_subscription_with_billing_journal($1, null, $2) v',
    [JSON.stringify(snapshot(ago(70))), JSON.stringify({ ...observation(), private: 'x' })]).then(r => r.rows[0].v);
  assert.equal(bad.journalFailed, true); assert.ok(bad.id);
  await assert.rejects(save(db, ago(69), { p_status: 'explode' }), /save failed/);
  assert.equal((await journal(db)).length, 0);
  await db.close();
});

test('reason linkage, offer acceptance, consent timing, expiry, deletion and privileges', { skip }, async () => {
  const db = await fresh(); await asService(db); await consentAt(db, ago(150));
  await save(db, ago(100));
  // Feedback inside the interval (after the previous verification, before the cancellation).
  await owner(db, `insert into public.subscription_cancellation_feedback values ($1, gen_random_uuid(), $2, 'too_expensive', 'PRIVATE free text', $3, null)`, [A, SUB, ago(95)]);
  await save(db, ago(90), { p_auto_renews: false }, { autoRenews: false });
  // Feedback given before the previous verification is not linked to a later cancellation.
  await owner(db, `insert into public.subscription_cancellation_feedback values ($1, gen_random_uuid(), $2, 'not_using', null, $3, null)`, [A, SUB, ago(89)]);
  await save(db, ago(85), { p_auto_renews: true }, { autoRenews: true });
  await save(db, ago(84), { p_auto_renews: false }, { autoRenews: false });
  // An accepted offer: journalled with its verified save, recorded once at its purchase time.
  await save(db, ago(60), { p_auto_renews: true }, { autoRenews: true, retentionOffer: { transactionId: 'offer-tx-1', purchasedAt: ago(61) } });
  await billing.drainBillingTransitions(client(db), A);
  const events = await outbox(db);
  assert.deepEqual(events.map(e => [e.event, e.properties.reason ?? null]),
    [['subscription_cancelled', 'too_expensive'], ['subscription_cancelled', 'unavailable'], ['retention_offer_accepted', null]]);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/, 'free text never enters analytics');
  assert.deepEqual(Object.keys(events[2].properties).sort(), ['environment', 'provider']);
  // The same offer transaction seen again (e.g. the notification after the app) is one event.
  await save(db, ago(50), { p_auto_renews: true }, { autoRenews: true, retentionOffer: { transactionId: 'offer-tx-1', purchasedAt: ago(61) } });
  await billing.drainBillingTransitions(client(db), A);
  assert.equal((await outbox(db)).filter(e => e.event === 'retention_offer_accepted').length, 1);

  // Choice made after the event: suppressed, and the row still completes (no retrospective consent).
  await consentAt(db, ago(30));
  await save(db, ago(40), { p_auto_renews: false }, { autoRenews: false });
  const before = (await outbox(db)).length;
  await billing.drainBillingTransitions(client(db), A);
  assert.equal((await outbox(db)).length, before); assert.equal((await journal(db)).length, 0);
  // Withdrawn choice: suppressed.
  await owner(db, 'update public.account_billing_analytics_consent set granted = false where user_id = $1', [A]);
  await save(db, ago(20), { p_auto_renews: true }, { autoRenews: true });
  await save(db, ago(19), { p_auto_renews: false }, { autoRenews: false });
  await billing.drainBillingTransitions(client(db), A);
  assert.equal((await outbox(db)).length, before);

  // Unsent rows expire after 7 days; deletion removes rows; client roles have no access.
  await save(db, ago(10), { p_auto_renews: true }, { autoRenews: true });
  await owner(db, "update public.billing_analytics_transitions set created_at = clock_timestamp() - interval '8 days'");
  assert.equal((await billing.drainBillingTransitions(client(db), A)).processed, 0);
  assert.equal((await journal(db)).length, 0);
  await save(db, ago(5), { p_auto_renews: false }, { autoRenews: false });
  await db.exec('reset role;'); await db.exec(`delete from auth.users where id='${A}'`);
  assert.equal((await db.query('select count(*)::int n from public.billing_analytics_transitions')).rows[0].n, 0);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(db.query('select * from public.billing_analytics_transitions'), /permission denied/, role);
    await assert.rejects(db.query('select public.complete_billing_analytics_transition(gen_random_uuid())'), /permission denied/, role);
    await assert.rejects(db.query('select * from public.pending_billing_analytics_transitions(null, 1)'), /permission denied/, role);
  }
  await db.exec("reset role; select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(db.query("select public.upsert_subscription_with_billing_journal('{}'::jsonb, null, null)"), /Forbidden/);
  await db.close();
});


async function freshPrivacy() {
  const db = await fresh();

  await db.exec(`
    create table public.account_export_artifacts(
      user_id uuid, expires_at timestamptz
    );
    create table public.account_privacy_confirmations(
      expires_at timestamptz
    );
    create table public.account_privacy_delivery_failures(
      created_at timestamptz
    );
    create table public.account_privacy_operations(
      completed_at timestamptz, state text
    );
  `);


  // Minimal stand-in for the existing account export contract.
  await db.exec(`
    create function public.account_export_dataset(p_user_id uuid)
    returns jsonb language sql as $fixture$
      select jsonb_build_object(
        'formatVersion', 1,
        'generatedAt', clock_timestamp(),
        'sections', jsonb_build_object(
          'billingAnalyticsChoice', '[]'::jsonb,
          'retentionOfferRedemptions', '[]'::jsonb
        ),
        'fieldExplanations', '{}'::jsonb
      );
    $fixture$;
  `);

  await db.exec(read('20261126180000_billing_journal_privacy.sql'));
  await db.exec(
    'grant execute on function public.cleanup_account_privacy_retention() to service_role'
  );

  await asService(db);
  return db;
}

test('privacy: subscription saves succeed without billing consent', { skip }, async () => {
  const db = await freshPrivacy();
  try {
    const result = await save(db, ago(10));

    assert.ok(result.id);
    assert.equal(result.journalId, null);
    assert.equal(result.journalFailed, false);
    assert.equal((await journal(db)).length, 0);

    const rows = await owner(db,
      'select status from public.subscription_entitlements'
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'active');
  } finally {
    await db.close();
  }
});

test('privacy: consent cannot apply retrospectively', { skip }, async () => {
  const db = await freshPrivacy();
  try {
    await consentAt(db, ago(10));

    const result = await save(db, ago(20));

    assert.ok(result.id);
    assert.equal(result.journalId, null);
    assert.equal((await journal(db)).length, 0);

    await save(db, ago(5));
    assert.equal((await journal(db)).length, 1);
  } finally {
    await db.close();
  }
});

test('privacy: withdrawal purges pending rows and regrant does not restore them', { skip }, async () => {
  const db = await freshPrivacy();
  try {
    await consentAt(db, ago(100));
    await save(db, ago(90));

    assert.equal((await journal(db)).length, 1);

    await owner(db,
      'update public.account_billing_analytics_consent set granted=false where user_id=$1',
      [A]
    );

    assert.equal((await journal(db)).length, 0);

    const result = await save(db, ago(80));
    assert.ok(result.id);
    assert.equal(result.journalId, null);
    assert.equal((await journal(db)).length, 0);

    await consentAt(db, ago(10));
    assert.equal((await journal(db)).length, 0);

    await save(db, ago(5));
    assert.equal((await journal(db)).length, 1);
  } finally {
    await db.close();
  }
});

test('privacy: deletion tombstone immediately purges pending journal', { skip }, async () => {
  const db = await freshPrivacy();
  try {
    await consentAt(db, ago(100));
    await save(db, ago(90));

    assert.equal((await journal(db)).length, 1);

    await owner(db,
      'insert into public.account_deletion_tombstones(user_id) values ($1)',
      [A]
    );

    assert.equal((await journal(db)).length, 0);

    await save(db, ago(80));
    assert.equal((await journal(db)).length, 0);
  } finally {
    await db.close();
  }
});

test('privacy: independent retention removes expired rows but preserves recent rows', { skip }, async () => {
  const db = await freshPrivacy();
  try {
    await consentAt(db, ago(100));
    await save(db, ago(90));
    await save(db, ago(80));

    assert.equal((await journal(db)).length, 2);

    await owner(db, `
      update public.billing_analytics_transitions
      set created_at=clock_timestamp()-interval '8 days'
      where verified_at=(
        select min(verified_at)
        from public.billing_analytics_transitions
      )
    `);

    await db.query('select public.cleanup_account_privacy_retention()');

    const rows = await journal(db);
    assert.equal(rows.length, 1);
  } finally {
    await db.close();
  }
});


test('privacy: billing export preserves sections and isolates account data', { skip }, async () => {
  const db = await freshPrivacy();
  try {
    const B = '00000000-0000-4000-8000-00000000000b';

    await owner(db, 'insert into auth.users(id) values ($1)', [B]);

    await consentAt(db, ago(100));
    await save(db, ago(90), {}, {
      trialFacts: {
        transactionId: 'private-trial-transaction',
        startedAt: '2026-11-20T10:00:00Z',
        endsAt: '2026-11-27T10:00:00Z',
      },
      verifiedPayment: {
        transactionId: 'private-payment-transaction',
        paidAt: '2026-11-27T10:00:00Z',
        amount: 49.99,
        verified: true,
        servicePeriodStart: '2026-11-27T10:00:00Z',
      },
      retentionOffer: {
        transactionId: 'private-offer-transaction',
        purchasedAt: '2026-11-27T10:00:00Z',
      },
    });

    assert.equal((await journal(db)).length, 1);

    const capture = async id => {
      const rows = await owner(db,
        'select public.account_export_dataset($1) as dataset',
        [id]
      );
      return rows[0].dataset;
    };

    const exported = await capture(A);

    assert.equal(exported.formatVersion, 1);
    assert.deepEqual(exported.sections.billingAnalyticsChoice, []);
    assert.deepEqual(exported.sections.retentionOfferRedemptions, []);
    assert.equal(exported.sections.pendingBillingAnalytics.length, 1);

    const entry = exported.sections.pendingBillingAnalytics[0];

    assert.equal(entry.provider, 'apple');
    assert.equal(entry.environment, 'sandbox');
    assert.equal(entry.status, 'active');

    assert.equal(entry.trialStartedAt, '2026-11-20T10:00:00Z');
    assert.equal(entry.trialEvidenceEndsAt, '2026-11-27T10:00:00Z');
    assert.equal(entry.paymentPaidAt, '2026-11-27T10:00:00Z');
    assert.equal(entry.paymentAmount, 49.99);
    assert.equal(entry.paymentVerified, true);
    assert.equal(entry.paymentServicePeriodStart, '2026-11-27T10:00:00Z');
    assert.equal(entry.retentionOfferPurchasedAt, '2026-11-27T10:00:00Z');

    const serialized = JSON.stringify(entry);

    for (const identifier of [
      'private-trial-transaction',
      'private-payment-transaction',
      'private-offer-transaction',
    ]) {
      assert.equal(serialized.includes(identifier), false);
    }


    for (const key of [
      'id', 'user_id', 'subscription_id',
      'provider_subscription_id', 'attempts',
      'latestTransactionId', 'consent_id'
    ]) {
      assert.equal(Object.hasOwn(entry, key), false);
    }

    const other = await capture(B);
    assert.deepEqual(other.sections.pendingBillingAnalytics, []);

    await owner(db,
      'update public.account_billing_analytics_consent set granted=false where user_id=$1',
      [A]
    );

    assert.deepEqual(
      (await capture(A)).sections.pendingBillingAnalytics,
      []
    );
  } finally {
    await db.close();
  }
});

test('privacy: billing export functions deny direct client access', { skip }, async () => {
  const db = await freshPrivacy();
  try {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('reset role; set role ' + role);

      for (const name of [
        'account_export_dataset',
        'account_export_dataset_before_billing_journal'
      ]) {
        await assert.rejects(
          db.query('select public.' + name + '($1)', [A]),
          /permission denied/
        );
      }
    }
  } finally {
    await db.close();
  }
});
