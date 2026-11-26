import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as apple from '@apple/app-store-server-library';

function load(path, deps) {
  const exports = {};
  const out = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(out, { exports, Buffer, Date, process: { env: {} }, require: id => { assert.ok(id in deps, id); return deps[id]; } });
  return exports;
}
const canCancel = item => item.provider === 'apple' && item.status === 'active' && Date.parse(item.current_period_end) > Date.now();
const lib = load('src/lib/native-subscriptions/retention-offer.ts', {
  'node:crypto': crypto, '@apple/app-store-server-library': apple, './cancellation': { canCancel },
});

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = {
  APPLE_IAP_RETENTION_OFFER_ID: 'retention_50_3m', APPLE_IAP_RETENTION_PRODUCT_IDS: 'pro.monthly',
  APPLE_IAP_OFFER_KEY_ID: 'KEY123', APPLE_IAP_OFFER_PRIVATE_KEY_BASE: Buffer.from(pem).toString('base64'),
};
const USER = '00000000-0000-4000-8000-00000000000A';
const row = (over = {}) => ({ id: 's1', user_id: USER, provider: 'apple', product_id: 'pro.monthly', plan: 'monthly',
  status: 'active', current_period_end: new Date(Date.now() + 864e5).toISOString(), ...over });

test('offer is off unless every store setting is present', () => {
  assert.equal(lib.retentionOfferConfig({}), null);
  for (const key of Object.keys(env)) assert.equal(lib.retentionOfferConfig({ ...env, [key]: '' }), null, key);
  assert.equal(lib.retentionOfferConfig({ ...env, APPLE_IAP_OFFER_PRIVATE_KEY_BASE: Buffer.from('not a key').toString('base64') }), null);
  assert.equal(lib.retentionOfferConfig(env).bundleId, 'co.uk.dadhealth');
});

test('signature verifies with the Apple promotional-offer payload and binds the member', () => {
  const config = lib.retentionOfferConfig(env);
  const nonce = 'A1B2C3D4-0000-4000-8000-000000000001';
  const signed = lib.signRetentionOffer(row(), USER, config, 1764000000000, nonce);
  assert.equal(signed.productId, 'pro.monthly');
  assert.deepEqual(Object.keys(signed.offer).sort(), ['identifier', 'keyIdentifier', 'nonce', 'signature', 'timestamp']);
  assert.equal(signed.offer.identifier, 'retention_50_3m');
  assert.equal(signed.offer.nonce, nonce.toLowerCase());
  const payload = ['co.uk.dadhealth', 'KEY123', 'pro.monthly', 'retention_50_3m', USER.toLowerCase(), nonce.toLowerCase(), '1764000000000'].join('⁣');
  assert.ok(crypto.verify('sha256', Buffer.from(payload), publicKey, Buffer.from(signed.offer.signature, 'base64')));
  const otherMember = payload.replace(USER.toLowerCase(), '00000000-0000-4000-8000-00000000000b');
  assert.equal(crypto.verify('sha256', Buffer.from(otherMember), publicKey, Buffer.from(signed.offer.signature, 'base64')), false);
});

test('each signature uses a fresh nonce', () => {
  const config = lib.retentionOfferConfig(env);
  const a = lib.signRetentionOffer(row(), USER, config), b = lib.signRetentionOffer(row(), USER, config);
  assert.notEqual(a.offer.nonce, b.offer.nonce);
});

test('no offer for another account, Google, ended access or a product without the offer', () => {
  const config = lib.retentionOfferConfig(env);
  assert.equal(lib.signRetentionOffer(row(), '00000000-0000-4000-8000-00000000000b', config), null);
  assert.equal(lib.signRetentionOffer(row({ provider: 'google' }), USER, config), null);
  assert.equal(lib.signRetentionOffer(row({ status: 'expired' }), USER, config), null);
  assert.equal(lib.signRetentionOffer(row({ product_id: 'pro.annual', plan: 'annual' }), USER, config), null);
});

test('route is authenticated, owner-scoped and reports unavailable instead of inventing an offer', () => {
  const route = readFileSync(new URL('../src/app/api/native-subscriptions/retention-offer/route.ts', import.meta.url), 'utf8');
  assert.match(route, /authenticateNativeSubscriptionRequest\(request\)[\s\S]*status: 401/);
  assert.match(route, /ownedSubscription\(auth, body\.subscriptionId\)/);
  assert.match(route, /signRetentionOffer\(item, auth\.user\.id, config\)/);
  assert.match(route, /state: 'offer_unavailable' \}, \{ status: 404/);
  assert.doesNotMatch(route, /console\.(log|info)/);
});

test('acceptance comes only from a verified promotional-offer transaction with our offer id', () => {
  const config = lib.retentionOfferConfig(env);
  assert.equal(lib.retentionOfferApplied({ offerType: 2, offerIdentifier: 'retention_50_3m' }, config), true);
  assert.equal(lib.retentionOfferApplied({ offerType: 2, offerIdentifier: 'another_offer' }, config), false, 'another offer');
  assert.equal(lib.retentionOfferApplied({ offerType: 1, offerIdentifier: 'retention_50_3m' }, config), false, 'introductory trial is not the retention offer');
  assert.equal(lib.retentionOfferApplied({ offerType: 3, offerIdentifier: 'retention_50_3m' }, config), false, 'offer code');
  assert.equal(lib.retentionOfferApplied({}, config), false, 'normal renewal / purchase');
  assert.equal(lib.retentionOfferApplied(null, config), false);
  assert.equal(lib.retentionOfferApplied({ offerType: 2, offerIdentifier: 'retention_50_3m' }, null), false, 'not configured: never accepted');
});

test('Apple verify returns the offer flag computed from the verified transaction only', () => {
  const route = readFileSync(new URL('../src/app/api/native-subscriptions/verify/apple/route.ts', import.meta.url), 'utf8');
  assert.match(route, /retentionOfferApplied: retentionOfferApplied\(verified\.transaction\)/);
  assert.doesNotMatch(route, /retentionOfferApplied[^;]*body\./, 'never from the client request');
});

// Client audit A3: durable record of an accepted retention offer.
const offerTx = (over = {}) => ({ offerType: apple.OfferType.PROMOTIONAL_OFFER, offerIdentifier: 'retention_50_3m',
  originalTransactionId: '2000000001', transactionId: '2000000099', productId: 'pro.monthly', purchaseDate: Date.UTC(2026, 10, 26, 12), ...over });
function rpcSpy(error = null) {
  const calls = [];
  return { calls, admin: { rpc: async (name, params) => { calls.push([name, params]); return { data: { recorded: true }, error }; } } };
}

test('an accepted offer is recorded once with Apple\'s verified fields and the verified owner', async () => {
  const config = lib.retentionOfferConfig(env), spy = rpcSpy();
  assert.equal(await lib.recordRetentionOfferRedemption(spy.admin, USER, { transaction: offerTx(), environment: 'sandbox' }, 'verified_purchase', config), true);
  assert.equal(JSON.stringify(spy.calls), JSON.stringify([['record_retention_offer_redemption', {
    p_user_id: USER, p_provider: 'apple', p_environment: 'sandbox', p_original_transaction_id: '2000000001',
    p_transaction_id: '2000000099', p_offer_identifier: 'retention_50_3m', p_product_id: 'pro.monthly',
    p_purchased_at: '2026-11-26T12:00:00.000Z', p_source: 'verified_purchase' }]]));
});

test('nothing is recorded without our verified promotional offer, or while the offer is off', async () => {
  const config = lib.retentionOfferConfig(env);
  for (const [label, tx, cfg] of [['no offer', offerTx({ offerType: undefined, offerIdentifier: undefined }), config],
    ['intro offer', offerTx({ offerType: apple.OfferType.INTRODUCTORY_OFFER }), config],
    ['other offer id', offerTx({ offerIdentifier: 'winback' }), config], ['offer off', offerTx(), null],
    ['no transaction', null, config]]) {
    const spy = rpcSpy();
    assert.equal(await lib.recordRetentionOfferRedemption(spy.admin, USER, { transaction: tx, environment: 'production' }, 'store_notification', cfg), false, label);
    assert.equal(spy.calls.length, 0, label);
  }
});

test('a failed or incomplete record throws without database detail, so callers can retry', async () => {
  const config = lib.retentionOfferConfig(env);
  await assert.rejects(lib.recordRetentionOfferRedemption(rpcSpy({ code: 'P0002', message: 'private' }).admin, USER,
    { transaction: offerTx(), environment: 'production' }, 'store_notification', config), /^Error: retention_offer_record_failed$/);
  for (const missing of ['originalTransactionId', 'transactionId', 'productId']) {
    const spy = rpcSpy();
    await assert.rejects(lib.recordRetentionOfferRedemption(spy.admin, USER, { transaction: offerTx({ [missing]: undefined }), environment: 'production' },
      'store_notification', config), /retention_offer_transaction_incomplete/, missing);
    assert.equal(spy.calls.length, 0);
  }
});

test('both Apple paths record after the verified save; only the notification path blocks acknowledgement', () => {
  const lf = text => text.replace(/\r\n/g, '\n'); // Windows checkouts use CRLF
  const verify = lf(readFileSync(new URL('../src/app/api/native-subscriptions/verify/apple/route.ts', import.meta.url), 'utf8'));
  const v = verify.indexOf('recordRetentionOfferRedemption(auth.admin, auth.user.id, verified, "verified_purchase")');
  assert.ok(v > verify.indexOf('await upsertSubscriptionEntitlement('), 'verify: after the entitlement save');
  assert.match(verify.slice(verify.lastIndexOf('try {', v), v + 400), /try \{\s+await recordRetentionOfferRedemption[\s\S]+\} catch \(error\) \{\s+console\.error\("\[native-subscriptions\/apple-verify\] Retention offer record failed", \{\s+code: error instanceof Error \? error\.message/);
  const notify = lf(readFileSync(new URL('../src/app/api/native-subscriptions/notifications/apple/route.ts', import.meta.url), 'utf8'));
  const n = notify.indexOf("recordRetentionOfferRedemption(admin, userId,");
  assert.ok(n > notify.indexOf('await upsertSubscriptionEntitlement('), 'notification: after the entitlement save');
  assert.ok(n < notify.indexOf('await completeProviderEvent(admin, claimId);\n    return NextResponse.json({ ok: true });\n  } catch'), 'notification: before acknowledging');
  assert.match(notify.slice(n - 40, n), /await $/);
  assert.match(notify, /'store_notification'\);/);
});

test('offer evidence for analytics comes only from our verified promotional offer', () => {
  const config = lib.retentionOfferConfig(env);
  assert.equal(JSON.stringify(lib.retentionOfferEvidence(offerTx(), config)), JSON.stringify({ transactionId: '2000000099', purchasedAt: '2026-11-26T12:00:00.000Z' }));
  for (const tx of [offerTx({ offerIdentifier: 'winback' }), offerTx({ offerType: undefined }), offerTx({ purchaseDate: undefined }), offerTx({ transactionId: undefined }), null]) {
    assert.equal(lib.retentionOfferEvidence(tx, config), null);
  }
  assert.equal(lib.retentionOfferEvidence(offerTx(), null), null, 'offer off');
});
