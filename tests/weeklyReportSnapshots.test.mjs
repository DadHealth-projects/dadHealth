import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { spawn, spawnSync } from 'node:child_process';

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
function snapshot() {
  const available = value => ({ state: 'available', value });
  return { version: 2, period: { weekStart: '2026-11-09', weekEndExclusive: '2026-11-16',
    startsAt: '2026-11-09T00:00:00Z', endsAtExclusive: '2026-11-16T00:00:00Z',
    accountTimezone: 'Europe/London', scoringModel: 'canonical-fixture' },
    deliveryAt: '2026-11-15T18:00:00Z', capturedAt: '2026-11-15T18:01:00Z', cutoffAt: '2026-11-15T18:01:00Z',
    comparison: { state: 'unavailable', reason: 'snapshot_missing' },
    pillars: Object.fromEntries(['mind', 'body', 'bond'].map(p => [p, { score: available(70), changePoints: { state: 'unavailable' } }])),
    details: { workouts: available(0), bondSessions: available(2), checkins: available(6),
      streak: { days: available(12), protectedDates: [] }, narrative: 'PRIVATE',
      focus: { pillar: 'mind', action: 'mind_breathing', text: 'PRIVATE' } } };
}
function harness() {
  const h = { access: false, accessError: null, queryError: null, payload: snapshot(),
    rowOwner: 'owner', calls: [], filters: [], missing: false };
  const query = {
    select(fields) { h.calls.push(['select', fields]); return query; },
    eq(key, value) { h.filters.push([key, value]); return query; },
    async maybeSingle() {
      return { error: h.queryError, data: h.missing ? null : { user_id: h.rowOwner,
        reporting_week_start: '2026-11-09', delivery_at: '2026-11-15T18:00:00Z',
        captured_at: h.payload.capturedAt, payload: h.payload } };
    },
  };
  h.admin = {
    async rpc(name, params) { h.calls.push([name, params]); return { data: h.access, error: h.accessError }; },
    from(table) { h.calls.push(['from', table]); return query; },
  };
  h.read = () => readWeeklyReport(h.admin, 'owner', '2026-11-09', now);
  return h;
}

test('Free reads only public fields and both owner/week predicates are applied', async () => {
  const h = harness(), result = await h.read();
  assert.equal(result.state, 'available');
  assert.equal(result.result.access, 'free');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|workouts|bondSessions|checkins|streak|narrative|focus/);
  assert.deepEqual(h.filters, [['user_id', 'owner'], ['reporting_week_start', '2026-11-09']]);
  assert.equal(h.calls[0][0], 'user_has_pro_access');
  assert.equal(h.calls[0][1].p_user_id, 'owner');
});

test('current canonical access handles upgrade, downgrade and manual grant without rewriting the snapshot', async () => {
  const h = harness(), before = JSON.stringify(h.payload);
  h.access = true;
  assert.equal((await h.read()).result.report.details.workouts.value, 0);
  h.access = false;
  assert.equal((await h.read()).result.report.details, undefined);
  assert.equal(JSON.stringify(h.payload), before);
  assert.equal(h.calls.filter(c => c[0] === 'user_has_pro_access').length, 2);
});

test('unknown or failed canonical entitlement never exposes a snapshot', async () => {
  for (const value of [null, undefined, 'true', 1]) {
    const h = harness(); h.access = value;
    assert.equal((await h.read()).reason, 'entitlement_unavailable');
    assert.equal(h.calls.some(c => c[0] === 'from'), false);
  }
  const h = harness(); h.access = true; h.accessError = Error('private');
  assert.equal((await h.read()).reason, 'entitlement_unavailable');
});

test('missing and failed reads stay distinct and never invoke generation', async () => {
  const h = harness(); h.missing = true;
  assert.equal((await h.read()).reason, 'snapshot_missing');
  h.queryError = Error('private');
  assert.equal((await h.read()).reason, 'read_failed');
  assert.equal(h.calls.some(c => c[0].includes('capture')), false);
});

test('metadata mismatches, corrupt payload and another owner fail closed', async () => {
  for (const change of [h => h.rowOwner = 'other-owner', h => h.payload.version = 99,
    h => h.payload.period.weekStart = '2026-11-02', h => h.payload.details = null,
    h => h.payload.capturedAt = '2027-01-01T00:00:00Z',
    h => h.payload.comparison.reason = 'PRIVATE']) {
    const h = harness(); h.access = true; change(h);
    assert.equal((await h.read()).reason, 'invalid_snapshot');
  }
});

test('no read is published before London release, even for Pro', async () => {
  const h = harness(); h.access = true;
  const result = await readWeeklyReport(h.admin, 'owner', '2026-11-09', new Date('2026-11-15T17:59:59.999Z'));
  assert.equal(result.reason, 'not_released');
  assert.equal(h.calls.some(c => c[0] === 'from'), false);
});

test('late reads return stored capture unchanged, not reconstructed current scores', async () => {
  const h = harness(); h.access = true;
  const first = await h.read();
  const later = await readWeeklyReport(h.admin, 'owner', '2026-11-09', new Date('2026-12-20T18:00:00Z'));
  assert.equal(JSON.stringify(first), JSON.stringify(later));
  assert.equal(h.calls.some(c => c[0] === 'calculate_dad_score_period'), false);
});

test('parallel owners remain isolated; no shared response cache', async () => {
  const first = harness(), second = harness();
  second.rowOwner = 'other'; second.access = true;
  const [a, b] = await Promise.all([first.read(), readWeeklyReport(second.admin, 'other', '2026-11-09', now)]);
  assert.equal(a.result.access, 'free'); assert.equal(b.result.access, 'pro');
  assert.equal(first.filters[0][1], 'owner'); assert.equal(second.filters[0][1], 'other');
});

// Real PostgreSQL acceptance. Intentionally FAIL (never skip) when the explicitly
// isolated fixture container is unavailable. No connection URL or production fallback.
const container = 'dadhealth-weekly-phase-b-test';
const owner = '79000000-0000-4000-8000-000000000001';
function database(sql) {
  const isolation = spawnSync('docker', ['inspect', container, '--format', '{{.HostConfig.NetworkMode}}'], { encoding: 'utf8' });
  assert.equal(isolation.status, 0, isolation.stderr);
  assert.equal(isolation.stdout.trim(), 'none', 'Database must have networking disabled');
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
function session(sql) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1']);
  let output = '', error = '';
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => error += b);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(Error(error)));
  });
  child.stdin.end(sql);
  return { done, child };
}
async function waitFor(sql) {
  for (let i = 0; i < 100; i++) {
    if (database(sql) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Expected database synchronization condition was not observed');
}

test('canonical capture accuracy: all sources, future records, edits/deletes and November 23 activation', () => {
  database(readFileSync(new URL('../supabase/tests/weekly_report_capture_sources.test.sql', import.meta.url), 'utf8'));
  const payload = JSON.parse(database(`select build_weekly_report_candidate('${owner}','2026-11-23','2026-11-29T18:00Z')->'snapshot';`));
  assert.equal(contract.projectWeeklyReportV2(payload, 'free').report.details, undefined);
  assert.ok(contract.projectWeeklyReportV2(payload, 'pro').report.details);
});

test('atomic capture and publication while another connection writes activity', async () => {
  const originalWeight = Number(database("select checkin_weight from dad_score_model_config where model_version='60_40_10_30_v1';"));
  database(`delete from weekly_report_snapshots where user_id='${owner}' and reporting_week_start='2000-04-03';`);
  const holder = session(`begin; select pg_advisory_xact_lock(hashtextextended('weekly-report:${owner}:2000-04-03',0)); select pg_sleep(8); rollback;`);
  await waitFor("select exists(select 1 from pg_locks where locktype='advisory' and granted);");
  const capture = session(`select capture_weekly_report_candidate('${owner}','2000-04-03');`);
  await waitFor("select exists(select 1 from pg_locks where locktype='advisory' and not granted);");
  database(`begin; insert into workout_sessions(user_id,performed_at) values('${owner}','2000-04-09T12:00Z'); update dad_score_model_config set checkin_weight=${originalWeight + 1} where model_version='60_40_10_30_v1'; commit;`);
  await holder.done;
  const result = JSON.parse(await capture.done);
  assert.equal(result.snapshot.details.workouts.value, 1);
  assert.equal(JSON.parse(result.snapshot.period.scoringModel.slice(result.snapshot.period.scoringModel.indexOf(':') + 1)).legacy.checkin_weight, originalWeight + 1);
  const saved = database(`select payload::text from weekly_report_snapshots where user_id='${owner}' and reporting_week_start='2000-04-03';`);
  database(`delete from workout_sessions where user_id='${owner}' and performed_at='2000-04-09T12:00Z';`);
  database(`update dad_score_model_config set checkin_weight=${originalWeight} where model_version='60_40_10_30_v1';`);
  assert.equal(database(`select payload::text from weekly_report_snapshots where user_id='${owner}' and reporting_week_start='2000-04-03';`), saved);
});

test('concurrent generation publishes once and returns the same immutable snapshot', async () => {
  database(`delete from weekly_report_snapshots where user_id='${owner}' and reporting_week_start='2000-04-10';`);
  const first = session(`begin; select pg_advisory_xact_lock(hashtextextended('weekly-report:${owner}:2000-04-10',0)); select pg_sleep(8); select capture_weekly_report_candidate('${owner}','2000-04-10'); commit;`);
  await waitFor("select exists(select 1 from pg_locks where locktype='advisory' and granted);");
  const second = session(`select capture_weekly_report_candidate('${owner}','2000-04-10');`);
  await waitFor("select exists(select 1 from pg_locks where locktype='advisory' and not granted);");
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.deepEqual(JSON.parse(a), JSON.parse(b));
  assert.equal(database(`select count(*) from weekly_report_snapshots where user_id='${owner}' and reporting_week_start='2000-04-10';`), '1');
});
