import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function moduleAt(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Intl, Date, require: id => {
    if (!(id in dependencies)) throw Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  } });
  return exports;
}
const calendar = moduleAt('src/lib/reports/weekly-report-calendar.ts');
function harness() {
  const h = { signedIn: true, calls: [], fail: false,
    result: { state: 'available', result: { access: 'free', report: { version: 2 } } } };
  const { GET } = moduleAt('src/app/api/reports/weekly/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/native-subscriptions/auth': { authenticateNativeSubscriptionRequest: async () =>
      h.signedIn ? { user: { id: 'authenticated-owner' }, admin: 'server-client' } : null },
    '@/lib/reports/weekly-report-calendar': calendar,
    '@/lib/reports/weekly-report-snapshots': { readWeeklyReport: async (...args) => {
      h.calls.push(args); if (h.fail) throw Error('PRIVATE database detail'); return h.result;
    } },
  });
  h.get = (query = '') => GET(new Request(`https://example.test/api/reports/weekly${query}`));
  return h;
}

test('weekly API requires authentication and derives ownership from it', async () => {
  const h = harness(); h.signedIn = false;
  assert.equal((await h.get()).status, 401); assert.equal(h.calls.length, 0);
  h.signedIn = true;
  const result = await h.get('?week=2026-11-09');
  assert.equal(result.status, 200);
  assert.deepEqual(h.calls[0], ['server-client', 'authenticated-owner', '2026-11-09']);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(result.headers.get('Vary'), 'Authorization');
});

test('weekly API rejects user/tier overrides, duplicate selectors and invalid weeks', async () => {
  for (const query of ['?userId=someone', '?access=pro', '?tier=pro', '?week=', '?week=2026-02-30',
    '?week=2026-11-15', '?week=2026-11-09&week=2026-11-02']) {
    const h = harness(); assert.equal((await h.get(query)).status, 400); assert.equal(h.calls.length, 0);
  }
});

test('unavailable report and failed entitlement have honest statuses with no report', async () => {
  for (const [reason, status] of [['snapshot_missing', 404], ['not_released', 404],
    ['read_failed', 503], ['invalid_snapshot', 503], ['entitlement_unavailable', 503]]) {
    const h = harness(); h.result = { state: 'unavailable', reason };
    const response = await h.get();
    assert.equal(response.status, status);
    assert.equal((await response.json()).report, null);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});

test('unexpected backend errors never expose private errors or claim an empty report', async () => {
  const h = harness(); h.fail = true;
  const response = await h.get();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { state: 'unavailable', reason: 'read_failed', report: null });
});
