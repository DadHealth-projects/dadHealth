// Weekly report single read (read_weekly_report_rows): the API makes one database call that
// decides access first and only then reads saved snapshots. Mocked admin client; the real SQL
// ordering is proven on PostgreSQL in weeklyReportSingleRead.database.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(name, dependencies = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../src/lib/reports/${name}.ts`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Intl, Date, require: id => {
    if (!(id in dependencies)) throw Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  } });
  return exports;
}
const calendar = load('weekly-report-calendar');
const contract = load('weekly-report');
const { readWeeklyReport } = load('weekly-report-snapshots', {
  './weekly-report-calendar': calendar, './weekly-report': contract,
});
const now = new Date('2026-11-16T12:00:00Z');

function snapshot(weekStart = '2026-11-09', deliveryAt = '2026-11-15T06:00:00Z', total = 70) {
  const available = value => ({ state: 'available', value });
  const end = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const capturedAt = new Date(Date.parse(deliveryAt) + 60000).toISOString();
  return { version: 2, period: { weekStart, weekEndExclusive: end,
    startsAt: `${weekStart}T00:00:00Z`, endsAtExclusive: `${end}T00:00:00Z`,
    accountTimezone: 'Europe/London', scoringModel: 'canonical-fixture' },
    deliveryAt, capturedAt, cutoffAt: capturedAt, totalScore: available(total),
    comparison: { state: 'unavailable', reason: 'snapshot_missing' },
    pillars: Object.fromEntries(['mind', 'body', 'bond'].map(p => [p, { score: available(70), changePoints: { state: 'unavailable' } }])),
    details: { workouts: available(0), bondSessions: available(2), checkins: available(6),
      streak: { days: available(12), protectedDates: [] }, narrative: 'PRIVATE',
      focus: { pillar: 'mind', action: 'mind_breathing', text: 'PRIVATE' } } };
}
const row = (payload, owner = 'owner') => ({ user_id: owner, reporting_week_start: payload.period.weekStart,
  delivery_at: payload.deliveryAt, captured_at: payload.capturedAt, payload });
function withComparison() {
  const current = snapshot(), previous = snapshot('2026-11-02', '2026-11-08T06:00:00Z', 60);
  current.comparison = { state: 'available', previousPeriod: previous.period, previousWeekComplete: true, policy: 'matched_cutoff',
    policyApproved: true, currentComparedThrough: current.cutoffAt, previousComparedThrough: previous.cutoffAt,
    previousCapturedAt: previous.capturedAt, previousDeliveryAt: previous.deliveryAt };
  return { current, previous };
}

/** Fake admin client: the single read answers with `reply`; any other call is recorded as a violation. */
function harness(reply) {
  const h = { rpcCalls: [], otherCalls: [] };
  h.admin = {
    async rpc(name, params) {
      h.rpcCalls.push([name, params]);
      if (name === 'read_weekly_report_rows') return typeof reply === 'function' ? reply(params) : reply;
      h.otherCalls.push(name); return { data: true, error: null };
    },
    from(table) { h.otherCalls.push(`from:${table}`); throw Error('direct table read'); },
  };
  return h;
}

test('one database call carries the verified owner, the requested week and the server time; nothing else is read', async () => {
  const h = harness({ data: { access: false, current: row(snapshot()), prior: null }, error: null });
  const result = await readWeeklyReport(h.admin, 'owner', '2026-11-09', now);
  assert.equal(result.state, 'available');
  assert.equal(JSON.stringify(h.rpcCalls), JSON.stringify([['read_weekly_report_rows', { p_user_id: 'owner', p_week: '2026-11-09', p_now: now.toISOString() }]]));
  assert.deepEqual(h.otherCalls, []);
});

test('latest-week reads pass no week and validate against the returned week', async () => {
  const h = harness({ data: { access: true, current: row(snapshot()), prior: null }, error: null });
  const result = await readWeeklyReport(h.admin, 'owner', undefined, now);
  assert.equal(h.rpcCalls[0][1].p_week, null);
  assert.equal(result.state, 'available');
  assert.equal(result.result.access, 'pro');
  assert.equal(result.result.report.details.workouts.value, 0);
});

test('Free gets only public fields; Pro gets details; the stored snapshot is not modified', async () => {
  const payload = snapshot(), before = JSON.stringify(payload);
  const free = await readWeeklyReport(harness({ data: { access: false, current: row(payload), prior: null }, error: null }).admin, 'owner', '2026-11-09', now);
  assert.equal(free.result.access, 'free');
  assert.doesNotMatch(JSON.stringify(free), /PRIVATE|workouts|bondSessions|checkins|streak|narrative|focus/);
  const pro = await readWeeklyReport(harness({ data: { access: true, current: row(payload), prior: null }, error: null }).admin, 'owner', '2026-11-09', now);
  assert.equal(pro.result.access, 'pro');
  assert.ok(pro.result.report.details);
  assert.equal(JSON.stringify(payload), before);
});

test('unknown access never exposes a snapshot, even if one were returned', async () => {
  for (const access of [null, undefined, 'true', 1, 0, {}]) {
    const h = harness({ data: { access, current: row(snapshot()), prior: null }, error: null });
    const result = await readWeeklyReport(h.admin, 'owner', '2026-11-09', now);
    assert.equal(JSON.stringify(result), JSON.stringify({ state: 'unavailable', reason: 'entitlement_unavailable' }), String(access));
  }
  for (const data of [null, false, true, 'x', [], 7]) {
    const result = await readWeeklyReport(harness({ data, error: null }).admin, 'owner', '2026-11-09', now);
    assert.equal(result.reason, 'entitlement_unavailable', JSON.stringify(data));
  }
});

test('a failed single read fails closed and never falls back to separate reads', async () => {
  for (const code of ['57014', 'PGRST003', '42501', 'XX000', undefined]) {
    const h = harness({ data: null, error: { code, message: 'private detail' } });
    const result = await readWeeklyReport(h.admin, 'owner', '2026-11-09', now);
    assert.equal(JSON.stringify(result), JSON.stringify({ state: 'unavailable', reason: 'entitlement_unavailable' }), String(code));
    assert.deepEqual(h.otherCalls, [], String(code));
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});

test('only a not-installed function selects the earlier path, which still checks access before reading', async () => {
  for (const code of ['PGRST202', '42883']) {
    const order = [];
    const query = { select() { return query; }, eq() { return query; },
      async maybeSingle() { order.push('snapshot'); return { data: row(snapshot()), error: null }; } };
    const admin = {
      async rpc(name) {
        order.push(name);
        return name === 'read_weekly_report_rows' ? { data: null, error: { code } } : { data: false, error: null };
      },
      from() { return query; },
    };
    const result = await readWeeklyReport(admin, 'owner', '2026-11-09', now);
    assert.equal(result.state, 'available', code);
    assert.deepEqual(order, ['read_weekly_report_rows', 'user_has_pro_access', 'snapshot'], code);
  }
});

test('missing, unreleased and invalid snapshots keep their distinct reasons', async () => {
  const missing = await readWeeklyReport(harness({ data: { access: true, current: null, prior: null }, error: null }).admin, 'owner', '2026-11-09', now);
  assert.equal(missing.reason, 'snapshot_missing');
  const early = await readWeeklyReport(harness({ data: { access: true, current: row(snapshot()), prior: null }, error: null }).admin,
    'owner', '2026-11-09', new Date('2026-11-15T05:59:59.999Z'));
  assert.equal(early.reason, 'not_released');
  for (const change of [r => r.user_id = 'other', r => r.payload.version = 99, r => r.payload.period.weekStart = '2026-11-02',
    r => r.payload.details = null, r => r.captured_at = '2026-11-15T07:00:00Z', r => r.payload.capturedAt = r.captured_at = '2027-01-01T00:00:00Z',
    r => r.reporting_week_start = '2026-11-02']) {
    const current = row(snapshot()); change(current);
    const result = await readWeeklyReport(harness({ data: { access: true, current, prior: null }, error: null }).admin, 'owner', '2026-11-09', now);
    assert.equal(result.reason, 'invalid_snapshot');
  }
});

test('prior snapshot gives the overall change only when it is the owner\'s compatible prior week', async () => {
  const cases = {
    valid: p => p, missing: () => null, 'wrong-owner': p => ({ ...p, user_id: 'other' }),
    'wrong-week': p => ({ ...p, reporting_week_start: '2026-10-26' }), 'wrong-capture': p => ({ ...p, captured_at: '2026-11-08T07:00:00Z' }),
    corrupt: p => ({ ...p, payload: { ...p.payload, period: null } }),
  };
  for (const [mode, change] of Object.entries(cases)) {
    const { current, previous } = withComparison();
    const h = harness({ data: { access: true, current: row(current), prior: change(row(previous)) }, error: null });
    const result = await readWeeklyReport(h.admin, 'owner', '2026-11-09', now);
    assert.equal(result.state, 'available', mode);
    assert.equal(result.result.report.overallChange.state, mode === 'valid' ? 'available' : 'unavailable', mode);
    if (mode === 'valid') assert.equal(result.result.report.overallChange.value, 10);
    assert.equal(h.rpcCalls.length, 1, mode);
    assert.deepEqual(h.otherCalls, [], mode);
  }
});

test('parallel owners remain isolated', async () => {
  const a = harness(p => ({ data: { access: p.p_user_id === 'owner' ? false : true, current: row(snapshot(), p.p_user_id), prior: null }, error: null }));
  const [first, second] = await Promise.all([readWeeklyReport(a.admin, 'owner', '2026-11-09', now), readWeeklyReport(a.admin, 'other', '2026-11-09', now)]);
  assert.equal(first.result.access, 'free'); assert.equal(second.result.access, 'pro');
  assert.deepEqual(a.rpcCalls.map(c => c[1].p_user_id).sort(), ['other', 'owner']);
});

test('migration: access is evaluated before any snapshot read; service role only; read-only', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261126140000_m3_weekly_report_single_read.sql', import.meta.url), 'utf8');
  const body = sql.slice(sql.indexOf('as $$'), sql.lastIndexOf('$$;'));
  const access = body.indexOf('public.user_has_pro_access(p_user_id)');
  const firstRead = body.indexOf('from public.weekly_report_snapshots');
  assert.ok(access > 0 && firstRead > access, 'access before read');
  assert.ok(body.indexOf("auth.role(), '') <> 'service_role'") < access, 'caller check first');
  assert.match(body.slice(access, firstRead), /if v_access is null then\s+--[^\n]*\n\s+return /);
  assert.doesNotMatch(body, /\b(insert|update|delete|truncate|perform)\b/i);
  assert.match(sql, /\bstable\b/);
  assert.match(sql, /security definer\s+set search_path = pg_catalog, public/);
  assert.match(sql, /revoke all on function public\.read_weekly_report_rows\(uuid, date, timestamptz\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.read_weekly_report_rows\(uuid, date, timestamptz\) to service_role;/);
  for (const m of body.matchAll(/from public\.weekly_report_snapshots s\s+where ([^;]+);/g)) assert.match(m[1], /s\.user_id = p_user_id/);
});
