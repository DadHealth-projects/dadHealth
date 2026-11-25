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
