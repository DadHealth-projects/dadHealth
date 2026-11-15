import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

// Only the existing network-isolated local full-schema database. Never a URL.
const container = 'dadhealth-weekly-full-schema';
const migration = readFileSync(new URL('../supabase/migrations/20261115110000_weekly_report_release_0600.sql', import.meta.url), 'utf8');
const owner = '7e060000-0000-4000-8000-000000000001';
function sql(source) {
  const inspect = spawnSync('docker', ['inspect', container, '--format', '{{.HostConfig.NetworkMode}}'], { encoding: 'utf8' });
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(inspect.stdout.trim(), 'none');
  return spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'dadhealth_phase_c', '-Atq', '-v', 'ON_ERROR_STOP=1'],
    { input: source, encoding: 'utf8', timeout: 30000 });
}
function run(source) {
  const result = sql(source);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}
const setup = `insert into auth.users(id) values('${owner}');
insert into public.user_profile(user_id,timezone,created_at) values('${owner}','UTC','1990-01-01')
on conflict(user_id) do update set timezone='UTC',created_at='1990-01-01';`;
const pendingMigration = migration.replace(/commit;\s*$/, '');

// Explicit storage fixture: does not claim canonical score-generation coverage.
function storedFixture(hour) {
  const at = `2000-01-09T${hour}:00:00Z`, measure = { state: 'available', value: 0 };
  return { version: 2, period: { weekStart: '2000-01-03', weekEndExclusive: '2000-01-10',
    startsAt: '2000-01-03T00:00:00Z', endsAtExclusive: '2000-01-10T00:00:00Z', accountTimezone: 'UTC', scoringModel: 'storage-fixture' },
    deliveryAt: at, capturedAt: at, cutoffAt: at, comparison: { state: 'unavailable', reason: 'snapshot_missing' },
    pillars: Object.fromEntries(['mind','body','bond'].map(p => [p, { score: measure, changePoints: { state: 'unavailable' } }])),
    details: { workouts: measure, bondSessions: measure, checkins: measure, streak: { days: measure, protectedDates: [] }, narrative: null, focus: null } };
}
function insertFixture(hour) {
  return `insert into public.weekly_report_snapshots values('${owner}','2000-01-03','2000-01-09T${hour}:00Z','2000-01-09T${hour}:00Z','${JSON.stringify(storedFixture(hour))}'::jsonb);`;
}

function load(name, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/reports/' + name + '.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, Intl, require: name => dependencies[name] });
  return exports;
}
const calendar = load('weekly-report-calendar'), contract = load('weekly-report');
const { readWeeklyReport } = load('weekly-report-snapshots', { './weekly-report-calendar': calendar, './weekly-report': contract });

test('06:00 migration: real capture, immutable retry, stored JSON and Free/Pro API projection', async () => {
  const result = run(pendingMigration + setup + `
set request.jwt.claim.role='service_role';
select public.capture_weekly_report_snapshot('${owner}','2000-01-03');
select public.capture_weekly_report_snapshot('${owner}','2000-01-03');
select row_to_json(r) from public.weekly_report_snapshots r where user_id='${owner}';
rollback;`);
  const [first, retry, row] = result.stdout.trim().split('\n').filter(x => x.startsWith('{')).map(JSON.parse);
  assert.equal(first.state, 'available'); assert.deepEqual(first, retry);
  assert.deepEqual(row.payload, first.snapshot);
  assert.equal(Date.parse(row.delivery_at), Date.parse('2000-01-09T06:00:00Z'));
  for (const pro of [false, true]) {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) };
    const admin = { rpc: async () => ({ data: pro, error: null }), from: () => q };
    const read = await readWeeklyReport(admin, owner, '2000-01-03', new Date(Date.now() + 1000));
    assert.equal(read.state, 'available');
    assert.equal(read.result.access, pro ? 'pro' : 'free');
    assert.equal(Boolean(read.result.report.details), pro);
  }
});

test('06:00 migration: SQL validator and builder agree at GMT/BST release boundaries', () => {
  const result = run(pendingMigration + setup + `
select jsonb_build_object('week',wk,'before',public.validate_weekly_report_observation('${owner}',wk,release-interval '1 millisecond'),
 'at',public.build_weekly_report_candidate('${owner}',wk,release))
from (values ('2026-03-16'::date),('2026-03-23'::date),('2026-10-12'::date),('2026-10-19'::date)) w(wk)
cross join lateral(select ((wk+6)::timestamp+interval '6 hours') at time zone 'Europe/London' release) r;
rollback;`);
  for (const row of result.stdout.trim().split('\n').filter(x => x.startsWith('{')).map(JSON.parse)) {
    assert.equal(row.before.reason, 'before_release'); assert.equal(row.at.state, 'available');
    assert.equal(Date.parse(row.at.snapshot.deliveryAt), Date.parse(calendar.reportReleaseForWeek(row.week).deliveryAt));
    assert.equal(contract.projectWeeklyReportV2(row.at.snapshot, 'free').access, 'free');
  }
});

test('06:00 migration: incompatible immutable snapshots abort without modification', () => {
  const result = sql(`begin; ${setup}
${insertFixture('18')}
${migration.replace(/^begin;$/m, '').replace(/commit;\s*$/, '')}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Existing weekly snapshots require release compatibility review/);
  // Failed session rolled back its fixture and all migration statements.
  assert.equal(run(`select count(*) from auth.users where id='${owner}';`).stdout.trim(), '0');
  assert.match(run("select pg_get_constraintdef(oid) from pg_constraint where conname='weekly_report_release';").stdout, /18:00:00/);
});

test('06:00 migration: capture diagnostics contain SQLSTATE/constraint only; response stays generic', () => {
  const result = run(pendingMigration + setup + `
-- Transaction-local fault injection; rolled back with the test, never deployed.
create or replace function public.reconcile_checkin_streak(p_user_id uuid) returns jsonb language plpgsql as $$
begin return jsonb_build_object('state','current','through',current_date); end $$;
create or replace function public.capture_weekly_report_snapshot(p_user_id uuid,p_week_start date) returns jsonb language plpgsql as $$
begin raise exception 'PRIVATE_PAYLOAD_AND_IDENTITY' using errcode='23514',constraint='weekly_report_release'; end $$;
set request.jwt.claim.role='service_role'; set client_min_messages='log';
select public.reconcile_and_capture_weekly_report('${owner}','2000-01-03');
rollback;`);
  assert.match(result.stderr, /weekly_report_capture_failed sqlstate=23514 constraint=weekly_report_release/);
  assert.doesNotMatch(result.stderr + result.stdout, /PRIVATE_PAYLOAD_AND_IDENTITY/);
  const response = JSON.parse(result.stdout.trim().split('\n').find(x => x.startsWith('{')));
  assert.deepEqual(response, { state: 'unavailable', reason: 'capture_failed' });
});


test('06:00 migration: real table accepts 06:00, rejects 18:00, stored payload projects securely', async () => {
  const result = run(pendingMigration + setup + insertFixture('06') + `
select row_to_json(r) from public.weekly_report_snapshots r where user_id='${owner}';
rollback;`);
  const row = JSON.parse(result.stdout.trim());
  for (const access of [false, true]) {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row }) };
    const response = await readWeeklyReport({ rpc: async () => ({ data: access }), from: () => q }, owner, '2000-01-03');
    assert.equal(response.state, 'available');
    assert.equal(Boolean(response.result.report.details), access);
  }
  const rejected = sql(pendingMigration + setup + insertFixture('18') + 'rollback;');
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /weekly_report_release/);
});

test('06:00 migration: permissions remain restricted and future release is rejected', () => {
  const result = run(pendingMigration + setup + `
select has_function_privilege('anon','public.capture_weekly_report_snapshot(uuid,date)','execute'),
 has_function_privilege('authenticated','public.capture_weekly_report_snapshot(uuid,date)','execute'),
 has_function_privilege('service_role','public.capture_weekly_report_snapshot(uuid,date)','execute'),
 has_function_privilege('service_role','public.build_weekly_report_candidate(uuid,date,timestamptz)','execute');
set request.jwt.claim.role='service_role';
select public.capture_weekly_report_snapshot('${owner}','2099-01-05')->>'reason';
rollback;`);
  assert.deepEqual(result.stdout.trim().split('\n'), ['f|f|t|f','not_released']);
});
