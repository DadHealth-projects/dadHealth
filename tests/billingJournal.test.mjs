// Client audit A6: durable billing transitions. Mocked database; the transactional journal is
// proven on PostgreSQL in billingJournal.database.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, mocks = {}, env = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, process: { env }, Date, AbortSignal, console: { warn() {} }, JSON, Array, Promise,
    require: id => id in mocks ? mocks[id] : require(id) });
  return exports;
}
const ON = { ANALYTICS_BILLING_COLLECTION_ENABLED: 'true', ANALYTICS_INGEST_ENABLED: 'true', ANALYTICS_PRIVACY_ENABLED: 'true' };
const contract = load('src/lib/analytics/contract.ts');
const billingOn = load('src/lib/analytics/billing.ts', { './contract': contract }, ON);
const billingOff = load('src/lib/analytics/billing.ts', { './contract': contract }, {});

const row = (over = {}) => ({ id: 'j1', user_id: 'owner', provider: 'apple', environment: 'sandbox', provider_subscription_id: 'orig',
  verified_at: '2026-11-27T10:00:00Z',
  previous: { user_id: 'owner', provider: 'apple', environment: 'sandbox', provider_subscription_id: 'orig', status: 'active',
    auto_renews: true, trial_end: null, current_period_end: '2026-12-20T00:00:00Z', last_verified_at: '2026-11-26T10:00:00Z' },
  observed: { status: 'active', autoRenews: false, latestTransactionId: 'tx2', trialEnd: null, trialFacts: null, verifiedPayment: null },
  ...over });
function chain(result) { return { abortSignal: async () => result, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }; }
function admin(handler) {
  const calls = [];
  return { calls, rpc(name, params) { calls.push([name, params]); return chain(handler(name, params, calls)); } };
}

test('gates: every switch must be on; default is off', () => {
  assert.equal(billingOff.billingCollectionEnabled({}), false);
  for (const key of Object.keys(ON)) assert.equal(billingOn.billingCollectionEnabled({ ...ON, [key]: 'false' }), false, key);
  assert.equal(billingOn.billingCollectionEnabled(ON), true);
});

test('a stored transition yields the same facts as the live rules, from its own verified previous state', () => {
  const cancelled = billingOn.journalFacts(row());
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].event, 'subscription_cancelled');
  assert.equal(JSON.stringify(cancelled[0].properties), JSON.stringify({ provider: 'apple', environment: 'sandbox', reason: 'unavailable' }));
  assert.equal(cancelled[0].timestamp, '2026-11-27T10:00:00.000Z');
  // Same row twice gives the same idempotency key.
  assert.equal(billingOn.journalFacts(row())[0].key, cancelled[0].key);
  // A trial start from verified trial facts; no previous state needed.
  const trial = billingOn.journalFacts(row({ previous: null, observed: { status: 'trialing', autoRenews: true, latestTransactionId: 't',
    trialEnd: '2026-12-04T10:00:00Z', trialFacts: { transactionId: 't', startedAt: '2026-11-27T09:00:00Z', endsAt: '2026-12-04T09:00:00Z' }, verifiedPayment: null } }));
  assert.equal(JSON.stringify(trial.map(f => f.event)), '["trial_started"]');
  // Out of order: a row verified no later than its previous state yields nothing.
  assert.equal(billingOn.journalFacts(row({ verified_at: '2026-11-26T09:00:00Z' })).length, 0);
  // Another owner's previous state never produces a fact.
  assert.equal(billingOn.journalFacts(row({ previous: { ...row().previous, user_id: 'other' } })).length, 0);
  // A conversion needs verified positive payment after the trial (unchanged rule).
  const conv = row({ previous: { ...row().previous, status: 'trialing', trial_end: '2026-11-27T09:00:00Z', auto_renews: true },
    observed: { status: 'active', autoRenews: true, latestTransactionId: 'tx2', trialEnd: '2026-11-27T09:00:00Z', trialFacts: null,
      verifiedPayment: { transactionId: 'tx2', paidAt: '2026-11-27T09:30:00Z', amount: 6.99, verified: true } } });
  assert.equal(JSON.stringify(billingOn.journalFacts(conv).map(f => f.event)), '["trial_converted"]');
  assert.equal(billingOn.journalFacts({ ...conv, observed: { ...conv.observed, verifiedPayment: { ...conv.observed.verifiedPayment, amount: 0 } } }).length, 0);
});

test('drain records each fact through the consent-checked path, then completes the row', async () => {
  const db = admin(name => name === 'pending_billing_analytics_transitions' ? { data: [row()], error: null }
    : { data: true, error: null });
  const result = await billingOn.drainBillingTransitions(db, 'owner');
  assert.equal(JSON.stringify(result), JSON.stringify({ suppressed: false, processed: 1, collected: 1, failed: 0 }));
  assert.deepEqual(db.calls.map(c => c[0]), ['pending_billing_analytics_transitions', 'record_account_billing_analytics', 'complete_billing_analytics_transition']);
  const recorded = db.calls[1][1];
  assert.equal(recorded.p_owner, 'owner'); assert.equal(recorded.p_event, 'subscription_cancelled');
  assert.equal(recorded.p_observed_after, '2026-11-26T10:00:00Z', 'cancellation interval starts at the verified previous state');
  assert.equal(recorded.p_verified_at, '2026-11-27T10:00:00.000Z');
  assert.equal(db.calls[2][1].p_id, 'j1');
});

test('a fact suppressed by consent (false) still completes; a failure leaves the row for retry', async () => {
  const suppressed = admin(name => name === 'pending_billing_analytics_transitions' ? { data: [row()], error: null } : { data: false, error: null });
  const s = await billingOn.drainBillingTransitions(suppressed, 'owner');
  assert.equal(s.processed, 1); assert.equal(s.collected, 0);
  for (const failing of ['record_account_billing_analytics', 'complete_billing_analytics_transition']) {
    const db = admin(name => name === 'pending_billing_analytics_transitions' ? { data: [row(), row({ id: 'j2' })], error: null }
      : name === failing ? { data: null, error: { code: '57014' } } : { data: true, error: null });
    const r = await billingOn.drainBillingTransitions(db, null);
    assert.equal(r.failed, 2, failing); assert.equal(r.processed, 0, failing);
    if (failing === 'record_account_billing_analytics') assert.equal(db.calls.filter(c => c[0] === 'complete_billing_analytics_transition').length, 0);
  }
  const unavailable = admin(() => ({ data: null, error: { code: 'PGRST202' } }));
  assert.equal((await billingOn.drainBillingTransitions(unavailable, 'owner')).failed, 1);
});

test('collection off: no journal read, no record, nothing collected', async () => {
  const db = admin(() => { throw Error('no database call expected'); });
  const r = await billingOff.drainBillingTransitions(db, 'owner');
  assert.equal(r.suppressed, true); assert.equal(db.calls.length, 0);
});

function storeWith(env, handler, drainError = null) {
  const billing = load('src/lib/analytics/billing.ts', { './contract': contract }, env);
  const drains = [];
  const store = load('src/lib/native-subscriptions/store.ts', {
    '@/lib/analytics/billing': { ...billing, drainBillingTransitions: async (a, owner) => { drains.push(owner); if (drainError) throw drainError; return {}; } },
    '@/utils/supabase/admin': {}, '@/lib/privacy/operations': { privacyOwnerRemoved: async () => false, RemovedPrivacyOwnerError: class extends Error {} },
    './types': load('src/lib/native-subscriptions/types.ts'),
  }, env);
  const db = admin(handler);
  return { store, db, drains };
}
const input = { userId: 'owner', provider: 'apple', providerSubscriptionId: 'orig', status: 'active', currentPeriodEnd: '2099-01-01T00:00:00Z',
  environment: 'sandbox', lastVerifiedAt: '2026-11-27T10:00:00Z', autoRenews: false, latestTransactionId: 'tx2' };
const saved = { data: { id: 'sub', previous: null, current: { last_verified_at: '2026-11-27T10:00:00Z' }, journalId: 'j1', journalFailed: false }, error: null };

test('store: with collection on, the journal is written by the same call as the verified save, then drained', async () => {
  const { store, db, drains } = storeWith(ON, () => saved);
  assert.equal(await store.upsertSubscriptionEntitlement(db, input), 'sub');
  assert.equal(db.calls[0][0], 'upsert_subscription_with_billing_journal');
  assert.equal(JSON.stringify(db.calls[0][1].p_journal), JSON.stringify({ status: 'active', autoRenews: false, latestTransactionId: 'tx2',
    trialEnd: null, trialFacts: null, verifiedPayment: null }));
  assert.equal(db.calls[0][1].p_snapshot.p_last_verified_at, '2026-11-27T10:00:00Z');
  assert.deepEqual(drains, ['owner']);
  assert.equal(db.calls.some(c => c[0] === 'record_account_billing_analytics'), false, 'no direct, non-durable collection');
});

test('store: before the journal SQL exists, the save is unchanged and nothing is collected', async () => {
  const { store, db, drains } = storeWith(ON, name => name === 'upsert_subscription_with_billing_journal'
    ? { data: null, error: { code: 'PGRST202' } } : saved);
  assert.equal(await store.upsertSubscriptionEntitlement(db, input), 'sub');
  assert.deepEqual(db.calls.map(c => c[0]), ['upsert_subscription_with_billing_journal', 'upsert_subscription_analytics_snapshot']);
  assert.deepEqual(drains, []);
});

test('store: collection off keeps the original save call; save failures are never swallowed', async () => {
  const { store, db, drains } = storeWith({}, () => saved);
  await store.upsertSubscriptionEntitlement(db, input);
  assert.deepEqual(db.calls.map(c => c[0]), ['upsert_subscription_analytics_snapshot']); assert.deepEqual(drains, []);
  const failing = storeWith(ON, () => ({ data: null, error: { code: '23505' } }));
  await assert.rejects(failing.store.upsertSubscriptionEntitlement(failing.db, input), /already linked/);
  assert.deepEqual(failing.drains, []);
});

test('maintenance retries journalled transitions for all owners', () => {
  const route = readFileSync(new URL('../src/app/api/analytics/maintenance/route.ts', import.meta.url), 'utf8');
  assert.match(route, /drainBillingTransitions\(admin, null, 100\)/);
});

test('offer acceptance: one fact per verified offer transaction, at purchase time, provider and environment only', () => {
  const offer = row({ observed: { ...row().observed, autoRenews: true, retentionOffer: { transactionId: 'otx', purchasedAt: '2026-11-27T09:00:00Z' } } });
  const facts = billingOn.journalFacts(offer).filter(f => f.event === 'retention_offer_accepted');
  assert.equal(facts.length, 1);
  assert.equal(facts[0].timestamp, '2026-11-27T09:00:00.000Z');
  assert.equal(JSON.stringify(facts[0].properties), JSON.stringify({ provider: 'apple', environment: 'sandbox' }));
  assert.match(facts[0].key, /^billing:[a-f0-9]{64}$/);
  assert.equal(billingOn.journalFacts(offer).find(f => f.event === 'retention_offer_accepted').key, facts[0].key, 'stable key');
  for (const bad of [{ transactionId: '', purchasedAt: '2026-11-27T09:00:00Z' }, { transactionId: 'otx', purchasedAt: 'never' }]) {
    assert.equal(billingOn.journalFacts(row({ observed: { ...row().observed, retentionOffer: bad } })).some(f => f.event === 'retention_offer_accepted'), false);
  }
  assert.equal(JSON.stringify(billingOn.journalObservation({ status: 'active', retentionOffer: { transactionId: 'otx', purchasedAt: 'x' } }).retentionOffer),
    JSON.stringify({ transactionId: 'otx', purchasedAt: 'x' }));
  assert.equal('retentionOffer' in billingOn.journalObservation({ status: 'active' }), false);
});

test('both Apple routes pass verified offer evidence into the journalled save', () => {
  const lf = t => t.replace(/\r\n/g, '\n');
  const verify = lf(readFileSync(new URL('../src/app/api/native-subscriptions/verify/apple/route.ts', import.meta.url), 'utf8'));
  assert.match(verify, /const offer = retentionOfferEvidence\(verified\.transaction\);\n\s+await upsertSubscriptionEntitlement\(\n\s+auth\.admin,\n\s+\{ \.\.\.appleEntitlementInput\([^)]*\), \.\.\.\(offer \? \{ retentionOffer: offer \} : \{\}\) \},/);
  const notify = lf(readFileSync(new URL('../src/app/api/native-subscriptions/notifications/apple/route.ts', import.meta.url), 'utf8'));
  assert.match(notify, /\.\.\.\(retentionOfferEvidence\(verified\.transaction\) \? \{ retentionOffer: retentionOfferEvidence\(verified\.transaction\)! \} : \{\}\) \},/);
});

for (const [owner, budget] of [['owner', 5000], [null, 20000]]) {
  test(`recovery stops at its ${budget}ms budget without completing unfinished rows`, async () => {
    let now = Date.now();

    class FakeDate extends Date {
      static now() { return now; }
    }

    const exports = {};
    const signals = [];
    const calls = [];

    vm.runInNewContext(
      ts.transpileModule(
        readFileSync(new URL('../src/lib/analytics/billing.ts', import.meta.url), 'utf8'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022
          }
        }
      ).outputText,
      {
        exports,
        process: { env: ON },
        Date: FakeDate,
        AbortSignal: {
          timeout(ms) {
            signals.push(ms);
            return AbortSignal.timeout(ms);
          }
        },
        console: { warn() {} },
        JSON, Array, Promise,
        require: id => id === './contract' ? contract : require(id)
      }
    );

    const db = {
      rpc(name) {
        calls.push(name);

        return {
          async abortSignal() {
            if (name === 'pending_billing_analytics_transitions') {
              now += budget - 1000;
              return { data: [row()], error: null };
            }

            now += 1000;
            return { data: true, error: null };
          }
        };
      }
    };

    const result = await exports.drainBillingTransitions(db, owner);

    assert.deepEqual(signals, [3000, 1000]);
    assert.equal(result.processed, 0);
    assert.equal(result.collected, 1);

    assert.deepEqual(calls, [
      'pending_billing_analytics_transitions',
      'record_account_billing_analytics'
    ]);
  });
}


test('store: journal insertion failure preserves accepted subscription', async () => {
  const { store, db, drains } = storeWith(ON, () => ({
    ...saved,
    data: {
      ...saved.data,
      journalId: null,
      journalFailed: true,
    },
  }));

  assert.equal(
    await store.upsertSubscriptionEntitlement(db, input),
    'sub'
  );

  assert.deepEqual(db.calls.map(c => c[0]), [
    'upsert_subscription_with_billing_journal',
  ]);

  assert.deepEqual(drains, ['owner']);
});

test('store: unexpected recovery failure cannot invalidate accepted subscription', async () => {
  const { store, db, drains } = storeWith(
    ON,
    () => saved,
    new Error('Recovery unavailable')
  );

  assert.equal(
    await store.upsertSubscriptionEntitlement(db, input),
    'sub'
  );

  assert.deepEqual(db.calls.map(c => c[0]), [
    'upsert_subscription_with_billing_journal',
  ]);

  assert.deepEqual(drains, ['owner']);
});
