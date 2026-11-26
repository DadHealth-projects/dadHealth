// Weekly report reliability (client-approved 2026-11-26): access check and snapshot read run in parallel.
// Decisions are compared with a frozen copy of the previous sequential implementation (tests/fixtures).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const ORIGINAL = new URL('./fixtures/weekly-report-snapshots.sequential.ts', import.meta.url);
const PROPOSAL = new URL('../src/lib/reports/weekly-report-snapshots.ts', import.meta.url);
const WEEK = '2026-11-16', DELIVERY = '2026-11-23T06:00:00.000Z', OWNER = 'owner-a';
function load(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Date, Promise, setTimeout,
    require: (id) => ({
      './weekly-report-calendar': { latestReleasedReportWeek: () => ({ weekStart: WEEK, deliveryAt: DELIVERY }),
        reportReleaseForWeek: (w) => ({ weekStart: w, deliveryAt: DELIVERY }) },
      './weekly-report': { projectWeeklyReportV2: (input, tier) => ({ report: { comparison: { state: 'first_week' } }, tier, week: input.period.weekStart }) },
    })[id] ?? (() => { throw new Error(id); })(),
  });
  return exports;
}
const snapshot = { user_id: OWNER, reporting_week_start: WEEK, delivery_at: DELIVERY, captured_at: '2026-11-23T06:00:01.000Z',
  payload: { period: { weekStart: WEEK }, deliveryAt: DELIVERY, capturedAt: '2026-11-23T06:00:01.000Z' } };

function admin({ access = { data: false, error: null }, row = { data: snapshot, error: null }, accessMs = 0, rowMs = 0 } = {}) {
  const log = { events: [], filters: [], snapshotQueried: false };
  const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
  return { log, client: {
    rpc: (name, args) => { log.events.push(`rpc:start:${name}:${args.p_user_id}`); return later(accessMs, access).then((v) => { log.events.push('rpc:end'); return v; }); },
    from: (table) => {
      log.snapshotQueried = true;
      const q = { select: () => q, eq: (k, v) => { log.filters.push([k, v]); return q; }, lte: () => q, order: () => q, limit: () => q,
        maybeSingle: () => { log.events.push(`snapshot:start:${table}`); return later(rowMs, row).then((v) => { log.events.push('snapshot:end'); return v; }); } };
      return q;
    } } };
}
const original = load(ORIGINAL), proposal = load(PROPOSAL);
const after = new Date('2026-11-24T10:00:00Z'), before = new Date('2026-11-22T10:00:00Z');
const scenarios = {
  'free member, report available': {},
  'pro member, report available': { access: { data: true, error: null } },
  'access check fails': { access: { data: null, error: { code: '57014' } } },
  'access check returns a non-boolean': { access: { data: null, error: null } },
  'snapshot read error': { row: { data: null, error: { message: 'timeout' } } },
  'no saved snapshot': { row: { data: null, error: null } },
  'snapshot belongs to another owner': { row: { data: { ...snapshot, user_id: 'owner-b' }, error: null } },
};

for (const [name, setup] of Object.entries(scenarios)) {
  for (const [label, now] of [['after release', after], ['before release', before]]) {
    test(`same decision as the original: ${name}, ${label}`, async () => {
      const a = admin(setup), b = admin(setup);
      const expected = JSON.parse(JSON.stringify(await original.readWeeklyReport(a.client, OWNER, undefined, now)));
      const actual = JSON.parse(JSON.stringify(await proposal.readWeeklyReport(b.client, OWNER, undefined, now)));
      assert.deepEqual(actual, expected);
    });
  }
}

test('access check and snapshot read now overlap (were sequential)', async () => {
  const seq = admin({ accessMs: 40, rowMs: 40 }), par = admin({ accessMs: 40, rowMs: 40 });
  await original.readWeeklyReport(seq.client, OWNER, undefined, after);
  await proposal.readWeeklyReport(par.client, OWNER, undefined, after);
  assert.deepEqual(seq.log.events.slice(0, 3), ['rpc:start:user_has_pro_access:owner-a', 'rpc:end', 'snapshot:start:weekly_report_snapshots'], 'original waits');
  assert.ok(par.log.events.indexOf('snapshot:start:weekly_report_snapshots') < par.log.events.indexOf('rpc:end'), 'proposal starts both');
});

test('slow pair: total time is about the slower step, not the sum', async () => {
  const t0 = Date.now(); await original.readWeeklyReport(admin({ accessMs: 160, rowMs: 150 }).client, OWNER, undefined, after); const seq = Date.now() - t0;
  const t1 = Date.now(); await proposal.readWeeklyReport(admin({ accessMs: 160, rowMs: 150 }).client, OWNER, undefined, after); const par = Date.now() - t1;
  assert.ok(seq >= 300, `sequential ${seq} ms`); assert.ok(par < 260, `parallel ${par} ms`);
});

test('access controls kept: owner filter, no snapshot read before release, nothing returned when access is unknown', async () => {
  const a = admin(); await proposal.readWeeklyReport(a.client, OWNER, undefined, after);
  assert.deepEqual(a.log.filters[0], ['user_id', OWNER]);
  const b = admin(); assert.equal((await proposal.readWeeklyReport(b.client, OWNER, undefined, before)).reason, 'not_released');
  assert.equal(b.log.snapshotQueried, false, 'unreleased week is never read');
  const c = admin({ access: { data: null, error: { code: '57014' } } });
  const result = await proposal.readWeeklyReport(c.client, OWNER, undefined, after);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { state: 'unavailable', reason: 'entitlement_unavailable' }, 'snapshot data never leaves');
});

test('a thrown snapshot read becomes read_failed, never an unhandled rejection', async () => {
  const bad = admin(); bad.client.from = () => { const q = { select: () => q, eq: () => q, lte: () => q, order: () => q, limit: () => q, maybeSingle: () => Promise.reject(new Error('socket hang up')) }; return q; };
  const result = await proposal.readWeeklyReport(bad.client, OWNER, undefined, after);
  assert.equal(result.reason, 'read_failed');
});

test('Free members get the Free projection and Pro the Pro projection, whichever read finishes first', async () => {
  const free = await proposal.readWeeklyReport(admin({ access: { data: false, error: null } }).client, OWNER, undefined, after);
  const pro = await proposal.readWeeklyReport(admin({ access: { data: true, error: null } }).client, OWNER, undefined, after);
  assert.equal(free.result.tier, 'free'); assert.equal(pro.result.tier, 'pro');
  const slowAccess = await proposal.readWeeklyReport(admin({ access: { data: false, error: null }, accessMs: 60, rowMs: 0 }).client, OWNER, undefined, after);
  assert.equal(slowAccess.result.tier, 'free', 'the snapshot arriving first never decides the tier');
  const slowFailedAccess = await proposal.readWeeklyReport(admin({ access: { data: null, error: { code: '57014' } }, accessMs: 60, rowMs: 0 }).client, OWNER, undefined, after);
  assert.deepEqual(JSON.parse(JSON.stringify(slowFailedAccess)), { state: 'unavailable', reason: 'entitlement_unavailable' });
});

test('the access check is started before the snapshot read', async () => {
  const a = admin({ accessMs: 20, rowMs: 20 });
  await proposal.readWeeklyReport(a.client, OWNER, undefined, after);
  assert.equal(a.log.events[0], 'rpc:start:user_has_pro_access:owner-a');
});

test('saved snapshots are only read, never written (immutability)', async () => {
  const a = admin(); const writes = [];
  const from = a.client.from;
  a.client.from = (table) => { const q = from(table); for (const m of ['insert', 'update', 'upsert', 'delete']) q[m] = () => { writes.push(m); return q; }; return q; };
  await proposal.readWeeklyReport(a.client, OWNER, undefined, after);
  assert.deepEqual(writes, []);
  assert.doesNotMatch(readFileSync(PROPOSAL, 'utf8'), /\.(insert|update|upsert|delete)\(/);
});

test('the route still requires server-verified sign-in, and the owner comes from it', () => {
  const route = readFileSync(new URL('../src/app/api/reports/weekly/route.ts', import.meta.url), 'utf8');
  assert.match(route, /const auth = await authenticateNativeSubscriptionRequest\(request\);\s*if \(!auth\) return NextResponse\.json\(\{ error: 'Sign in required', code: 'unauthorized' \}, \{ status: 401, headers \}\);/);
  assert.match(route, /readWeeklyReport\(auth\.admin, auth\.user\.id, week\)/);
});
