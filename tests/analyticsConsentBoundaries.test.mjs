import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const owner = '11111111-1111-4111-8111-111111111111';
const consent = '22222222-2222-4222-8222-222222222222';
function harness(options = {}) {
  const calls = [], logs = [];
  const env = { ANALYTICS_RATE_SECRET: 'fixture', ANALYTICS_TRUST_VERCEL_IP: 'true', ANALYTICS_INGEST_ENABLED: 'true', ANALYTICS_PRIVACY_ENABLED: 'true', ...options.env };
  function load(path, mocks = {}) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
      { exports, require: id => id in mocks ? mocks[id] : require(id), process: { env }, Buffer, Date, Request, Response, AbortSignal, fetch, console: { warn: (...args) => logs.push(args) } });
    return exports;
  }
  const api = load('src/lib/analytics/service.ts', { './contract': load('src/lib/analytics/contract.ts') });
  const admin = {
    auth: { getUser: async () => { calls.push('auth'); return options.auth ?? { data: { user: { id: owner } } }; } },
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'analytics_rate_limit') return options.rate ?? { data: true };
      assert.equal(args.p_owner, owner);
      assert.match(args.p_hash, /^[a-f0-9]{64}$/);
      return options.issue ?? { data: { consent, expiresAt: '2099-01-01T00:00:00Z' } };
    },
  };
  const route = load('src/app/api/analytics/events/route.ts', {
    '@/lib/analytics/service': api,
    '@/utils/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/utils/supabase/server': { createServerSupabaseClient: () => { throw Error('native must use bearer'); } },
  });
  return { calls, logs, run: (body = { action: 'grant', owner }) => route.POST(new Request('https://fixture.invalid/api/analytics/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture', ...(options.noIp ? {} : { 'x-vercel-forwarded-for': '192.0.2.1' }) }, body: JSON.stringify(body),
  })) };
}
for (const [name, options, status, code, calls, stage] of [
  ['missing rate secret', { env: { ANALYTICS_RATE_SECRET: '' } }, 503, 'configuration_required', [], 'rate_limit'],
  ['missing trusted IP', { noIp: true }, 503, 'configuration_required', [], 'rate_limit'],
  ['untrusted forwarding', { env: { ANALYTICS_TRUST_VERCEL_IP: 'false' } }, 503, 'configuration_required', [], 'rate_limit'],
  ['rate RPC permissions', { rate: { error: { code: '42501', message: 'PRIVATE' } } }, 503, 'storage_unavailable', ['analytics_rate_limit'], 'rate_limit'],
  ['rate denied', { rate: { data: false } }, 429, 'rate_limited', ['analytics_rate_limit']],
  ['expired auth', { auth: { data: { user: null }, error: {} } }, 401, 'unauthorized', ['analytics_rate_limit', 'auth']],
  ['missing issue signature', { issue: { error: { code: 'PGRST202', details: 'PRIVATE' } } }, 503, 'storage_unavailable', ['analytics_rate_limit', 'auth', 'issue_analytics_consent'], 'issue_consent'],
  ['invalid issue response', { issue: { data: { consent, expires_at: '2099-01-01' } } }, 403, 'consent_unavailable', ['analytics_rate_limit', 'auth', 'issue_analytics_consent']],
]) test(`grant boundary: ${name}`, async () => {
  const h = harness(options), response = await h.run();
  assert.equal(response.status, status);
  assert.equal(response.headers.get('X-Analytics-Failure-Code'), code);
  assert.ok(response.headers.get('X-Analytics-Request-ID'));
  assert.deepEqual(h.calls, calls);
  assert.deepEqual(await response.json(), { error: 'Analytics unavailable' });
  if (stage) assert.equal(h.logs.at(-1)[1].stage, stage);
  const expected = options.rate?.error?.code ?? options.issue?.error?.code;
  if (expected) assert.equal(h.logs.at(-1)[1].databaseCode, expected);
  assert.ok(!JSON.stringify(h.logs).includes('PRIVATE'));
});
test('grant and renew return the validated capability without success logging', async () => {
  const h = harness(), response = await h.run();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.owner, owner); assert.equal(payload.consent, consent);
  assert.equal(payload.secret.length, 72); assert.equal(h.logs.length, 0);
  const renewed = await h.run({ action: 'renew', owner, consent, secret: payload.secret });
  assert.equal(renewed.status, 200);
  assert.equal((await renewed.json()).secret, payload.secret);
  assert.equal(h.calls.at(-1), 'renew_analytics_consent');
});
test('owner spoof never reaches consent RPC', async () => {
  const h = harness(), response = await h.run({ action: 'grant', owner: consent });
  assert.equal(response.status, 403); assert.deepEqual(h.calls, ['analytics_rate_limit', 'auth']);
});
test('arbitrary error code text is not logged or returned', async () => {
  const h = harness({ issue: { error: { code: 'PRIVATE email/token', message: 'PRIVATE' } } });
  const response = await h.run();
  assert.equal(response.status, 503);
  assert.equal(h.logs.at(-1)[1].databaseCode, undefined);
  assert.ok(!JSON.stringify(h.logs).includes('PRIVATE'));
});
