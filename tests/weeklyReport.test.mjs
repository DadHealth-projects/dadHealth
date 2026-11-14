import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/reports/weekly-report.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Intl, Date });
const { projectWeeklyReport: project, TREND_FALLBACK } = exports;
const available = value => ({ state: 'available', value });
function fixture() {
  const period = { weekStart: '2026-11-09', weekEndExclusive: '2026-11-16', startsAt: '2026-11-09T00:00:00Z',
    endsAtExclusive: '2026-11-16T00:00:00Z', accountTimezone: 'Europe/London', scoringModel: 'canonical-test-v1' };
  return { version: 1, period, deliveryAt: '2026-11-15T18:00:00Z', cutoffAt: '2026-11-15T18:00:00Z',
    comparison: { state: 'available', previousPeriod: { ...period, weekStart: '2026-11-02', weekEndExclusive: '2026-11-09',
      startsAt: '2026-11-02T00:00:00Z', endsAtExclusive: '2026-11-09T00:00:00Z' }, previousWeekComplete: true,
      policy: 'partial_week_vs_full_week', policyApproved: true,
      currentComparedThrough: '2026-11-15T18:00:00Z', previousComparedThrough: '2026-11-09T00:00:00Z' },
    pillars: { mind: { score: available(70), changePoints: available(3.5) }, body: { score: available(65), changePoints: available(-2) },
      bond: { score: available(80), changePoints: available(0) } },
    details: { workouts: available(0), bondSessions: { state: 'missing' }, checkins: { state: 'unavailable' },
      streak: { days: available(12), protectedDates: ['2026-11-10'] }, narrative: 'PRIVATE NARRATIVE',
      focus: { pillar: 'body', action: 'body_workout', text: 'PRIVATE FOCUS' } } };
}
test('canonical scores and point changes pass through without a scoring formula', () => {
  const result = project(fixture(), 'pro');
  assert.equal(result.report.version, 1);
  assert.equal(result.report.pillars.mind.score.value, 70);
  assert.equal(result.report.pillars.mind.changePoints.value, 3.5);
  assert.equal(result.report.pillars.body.changePoints.value, -2);
  assert.equal(result.report.pillars.bond.changePoints.value, 0);
  assert.equal(result.report.pillars.bond.trendMessage, null);
});
for (const reason of ['missing_history', 'incomplete_history', 'policy_unapproved', 'data_unavailable']) {
  test(`unavailable comparison: ${reason}`, () => {
    const input = fixture(); input.comparison = { state: 'unavailable', reason };
    const report = project(input, 'free').report;
    assert.equal(report.pillars.mind.trendMessage, 'Building first 7 day trend');
    assert.equal(report.pillars.mind.changePoints.state, 'unavailable');
    assert.equal(report.pillars.mind.score.value, 70);
  });
}
test('model mismatch, incomplete baseline and unapproved policy suppress deltas', () => {
  for (const [change, reason] of [
    [i => i.comparison.previousPeriod.scoringModel = 'old-model', 'model_mismatch'],
    [i => i.comparison.previousWeekComplete = false, 'incomplete_history'],
    [i => i.comparison.policyApproved = false, 'policy_unapproved'],
  ]) {
    const input = fixture(); change(input);
    const report = project(input, 'pro').report;
    assert.equal(report.comparison.reason, reason);
    assert.equal(report.pillars.body.trendMessage, TREND_FALLBACK);
  }
});
test('zero counts stay zero; missing and failed reads never become zero', () => {
  const details = project(fixture(), 'pro').report.details;
  assert.equal(details.workouts.value, 0);
  assert.equal(details.bondSessions.state, 'missing');
  assert.equal(details.checkins.state, 'unavailable');
  assert.equal('value' in details.checkins, false);
});
test('Free projection allowlists every nested field and strips private extras', () => {
  const input = fixture();
  input.secret = 'PRIVATE'; input.period.narrative = 'PRIVATE'; input.pillars.mind.score.focus = 'PRIVATE';
  input.comparison.details = 'PRIVATE'; input.comparison.previousPeriod.streak = 'PRIVATE';
  const result = project(input, 'free');
  assert.equal('details' in result.report, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|protectedDates|workouts|bondSessions|checkins|narrative|focus|streak/);
  assert.equal(Object.keys(result.report.pillars).length, 3);
});
test('unknown and failed access return no report; downgrade removes details', () => {
  for (const access of ['unknown', 'failed']) assert.equal(project(fixture(), access).report, null);
  assert.ok(project(fixture(), 'pro').report.details);
  assert.equal(project(fixture(), 'free').report.details, undefined);
});
test('missing pillar data suppresses its delta independently', () => {
  const input = fixture(); input.pillars.mind.score = { state: 'missing' };
  input.pillars.body.changePoints = { state: 'unavailable' };
  const report = project(input, 'pro').report;
  assert.equal(report.pillars.mind.trendMessage, TREND_FALLBACK);
  assert.equal(report.pillars.body.trendMessage, TREND_FALLBACK);
  assert.equal(report.pillars.bond.trendMessage, null);
});
for (const [sunday, utcHour] of [['2026-03-22', '18'], ['2026-03-29', '17'], ['2026-10-18', '17'], ['2026-10-25', '18']]) {
  test(`Sunday 18:00 London including DST: ${sunday}`, () => {
    const input = fixture(); const date = new Date(`${sunday}T00:00:00Z`);
    const key = offset => new Date(date.getTime() + offset * 86400000).toISOString().slice(0, 10);
    input.period = { ...input.period, weekStart: key(-6), weekEndExclusive: key(1), startsAt: `${key(-6)}T00:00:00Z`, endsAtExclusive: `${key(1)}T00:00:00Z` };
    input.deliveryAt = input.cutoffAt = `${sunday}T${utcHour}:00:00Z`;
    input.comparison = { state: 'unavailable', reason: 'missing_history' };
    assert.equal(project(input, 'free').report.delivery.time, '18:00');
    input.deliveryAt = `${sunday}T20:00:00Z`;
    assert.throws(() => project(input, 'free'), /Invalid report/);
  });
}
test('output preserves explicit cutoff metadata, is deterministic and does not mutate inputs', () => {
  const input = fixture(), before = JSON.stringify(input);
  const first = project(input, 'pro');
  assert.equal(JSON.stringify(first), JSON.stringify(project(input, 'pro')));
  assert.equal(JSON.stringify(input), before);
  assert.equal(first.report.cutoffAt, input.cutoffAt);
  assert.equal(first.report.comparison.policy, 'partial_week_vs_full_week');
  first.report.details.streak.protectedDates.push('2026-11-11');
  assert.equal(input.details.streak.protectedDates.length, 1);
});
test('invalid scores, counts and future cutoffs fail instead of fabricating data', () => {
  for (const change of [i => i.pillars.mind.score.value = NaN, i => i.details.workouts.value = -1,
    i => i.cutoffAt = '2026-11-15T19:00:00Z']) {
    const input = fixture(); change(input); assert.throws(() => project(input, 'pro'));
  }
});

test('unknown contract versions are rejected', () => {
  const input = fixture(); input.version = 2;
  assert.throws(() => project(input, 'free'), /Unsupported report version/);
});

test('previous week exclusive end is a valid comparison boundary', () => {
  const input = fixture();
  const report = project(input, 'pro').report;

  assert.equal(report.comparison.state, 'available');
  assert.equal(
    report.comparison.previousComparedThrough,
    input.comparison.previousPeriod.endsAtExclusive
  );
});

test('unapproved comparison policy never exposes score changes', () => {
  const input = fixture();
  input.comparison.policyApproved = false;

  const report = project(input, 'free').report;

  assert.equal(report.comparison.reason, 'policy_unapproved');

  for (const pillar of ['mind', 'body', 'bond']) {
    assert.equal(report.pillars[pillar].changePoints.state, 'unavailable');
    assert.equal(report.pillars[pillar].trendMessage, TREND_FALLBACK);
  }
});

const { projectWeeklyReportV2: projectV2 } = exports;
const calendar = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/reports/weekly-report-calendar.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
{ exports: calendar, Intl, Date });

function fixtureV2() {
  const input = fixture();
  input.version = 2;
  input.capturedAt = input.deliveryAt;
  input.comparison = { ...input.comparison, policy: 'matched_cutoff',
    previousComparedThrough: '2026-11-08T18:00:00Z', previousCapturedAt: '2026-11-08T18:00:00Z',
    previousDeliveryAt: '2026-11-08T18:00:00Z' };
  return input;
}

test('V2 matching observations preserve canonical scores and point deltas', () => {
  const input = fixtureV2();
  const result = projectV2(input, 'pro').report;
  assert.equal(result.version, 2);
  assert.equal(result.comparison.state, 'available');
  assert.equal(result.pillars.mind.score.value, 70);
  assert.equal(result.pillars.mind.changePoints.value, 3.5);
});

test('V2 late capture is honest and mismatched observations suppress changes', () => {
  const input = fixtureV2();
  input.capturedAt = input.cutoffAt = '2026-11-15T18:00:00.001Z';
  input.comparison.currentComparedThrough = input.cutoffAt;
  const report = projectV2(input, 'free').report;
  assert.equal(report.capturedAt, input.capturedAt);
  assert.equal(report.deliveryAt, '2026-11-15T18:00:00Z');
  assert.equal(report.comparison.reason, 'observation_mismatch');
  assert.equal(report.pillars.mind.changePoints.state, 'unavailable');
  assert.equal(report.pillars.mind.trendMessage, null);
});

test('V2 operational gaps are not labelled first-week history', () => {
  for (const reason of ['snapshot_missing', 'data_unavailable', 'observation_mismatch', 'model_mismatch', 'calendar_mismatch', 'policy_unapproved']) {
    const input = fixtureV2(); input.comparison = { state: 'unavailable', reason };
    const report = projectV2(input, 'free').report;
    assert.equal(report.comparison.reason, reason);
    assert.equal(report.pillars.body.trendMessage, null);
    assert.equal(report.pillars.body.changePoints.state, 'unavailable');
  }
  for (const reason of ['missing_history', 'incomplete_history']) {
    const input = fixtureV2(); input.comparison = { state: 'unavailable', reason };
    assert.equal(projectV2(input, 'free').report.pillars.body.trendMessage, TREND_FALLBACK);
  }
});

test('V2 timezone and model transitions never expose an incompatible delta', () => {
  for (const [field, value, reason] of [
    ['scoringModel', '60_40_10_30_v1', 'model_mismatch'],
    ['accountTimezone', 'America/Los_Angeles', 'calendar_mismatch'],
  ]) {
    const input = fixtureV2(); input.comparison.previousPeriod[field] = value;
    const report = projectV2(input, 'pro').report;
    assert.equal(report.comparison.reason, reason);
    assert.equal(report.pillars.mind.changePoints.state, 'unavailable');
  }
});

test('V2 never approves a partial week versus full week', () => {
  const input = fixtureV2(); input.comparison.policy = 'partial_week_vs_full_week';
  assert.equal(projectV2(input, 'free').report.comparison.reason, 'observation_mismatch');
});

test('V2 keeps overseas preceding week after local Monday and caps activity cutoff', () => {
  const input = fixtureV2();
  input.period = { ...input.period, accountTimezone: 'Pacific/Auckland',
    startsAt: '2026-11-08T11:00:00Z', endsAtExclusive: '2026-11-15T11:00:00Z' };
  input.cutoffAt = input.period.endsAtExclusive;
  input.comparison = { state: 'unavailable', reason: 'snapshot_missing' };
  const report = projectV2(input, 'free').report;
  assert.equal(report.period.weekStart, '2026-11-09');
  assert.equal(report.cutoffAt, '2026-11-15T11:00:00Z');
  assert.equal(report.capturedAt, '2026-11-15T18:00:00Z');
});

test('V2 Free allowlist and unknown entitlement never expose details or injected fields', () => {
  const input = fixtureV2();
  input.period.private = 'SECRET'; input.comparison.private = 'SECRET';
  input.comparison.previousPeriod.private = 'SECRET'; input.pillars.mind.score.private = 'SECRET';
  const report = projectV2(input, 'free');
  assert.doesNotMatch(JSON.stringify(report), /SECRET|PRIVATE|protectedDates|workouts|bondSessions|checkins|narrative|focus|streak/);
  assert.equal(projectV2(input, 'unknown').report, null);
  assert.equal(projectV2(input, 'failed').report, null);
  assert.equal(projectV2(input, 'pro').report.details.workouts.value, 0);
  assert.equal(projectV2(input, 'pro').report.details.bondSessions.state, 'missing');
});

test('V2 rejects impossible observations and wrong release labels', () => {
  for (const change of [
    i => i.capturedAt = '2026-11-15T17:59:59Z',
    i => i.cutoffAt = '2026-11-15T19:00:00Z',
    i => i.deliveryAt = '2026-11-08T18:00:00Z',
    i => i.comparison.previousCapturedAt = '2026-11-08T17:00:00Z',
  ]) { const input = fixtureV2(); change(input); assert.throws(() => projectV2(input, 'free')); }
});

test('V2 projection is deterministic and does not mutate the input', () => {
  const input = fixtureV2(), before = JSON.stringify(input);
  assert.equal(JSON.stringify(projectV2(input, 'pro')), JSON.stringify(projectV2(input, 'pro')));
  assert.equal(JSON.stringify(input), before);
});

for (const [week, expected] of [
  ['2026-03-16', '2026-03-22T18:00:00.000Z'], ['2026-03-23', '2026-03-29T17:00:00.000Z'],
  ['2026-10-12', '2026-10-18T17:00:00.000Z'], ['2026-10-19', '2026-10-25T18:00:00.000Z'],
  ['2026-11-23', '2026-11-29T18:00:00.000Z'],
]) {
  test(`London release boundary ${week}`, () => {
    const release = calendar.reportReleaseForWeek(week);
    assert.equal(release.deliveryAt, expected);
    assert.equal(calendar.latestReleasedReportWeek(new Date(expected)).weekStart, week);
    assert.notEqual(calendar.latestReleasedReportWeek(new Date(Date.parse(expected) - 1)).weekStart, week);
    assert.equal(calendar.latestReleasedReportWeek(new Date(Date.parse(expected) + 1)).weekStart, week);
  });
}

test('calendar rejects invalid dates and non-Mondays', () => {
  for (const key of ['2026-02-30', '2026-11-15', 'bad']) assert.throws(() => calendar.reportReleaseForWeek(key));
});

for (const [week, previousWeek, delivery, previousDelivery, capture, previousCapture] of [
  ['2026-03-23', '2026-03-16', '2026-03-29T17:00:00Z', '2026-03-22T18:00:00Z',
    '2026-03-29T18:00:00Z', '2026-03-22T18:00:00Z'],
  ['2026-10-19', '2026-10-12', '2026-10-25T18:00:00Z', '2026-10-18T17:00:00Z',
    '2026-10-25T19:00:00Z', '2026-10-18T19:00:00Z'],
]) {
  test(`V2 matched account observations survive UK DST with unequal release delays: ${week}`, () => {
    const input = fixtureV2();
    const end = new Date(Date.parse(`${week}T00:00:00Z`) + 7 * 86400000).toISOString();
    input.period = { ...input.period, accountTimezone: 'UTC', weekStart: week,
      weekEndExclusive: end.slice(0, 10), startsAt: `${week}T00:00:00Z`, endsAtExclusive: end };
    input.deliveryAt = delivery;
    input.capturedAt = input.cutoffAt = capture;
    input.comparison = { ...input.comparison,
      previousPeriod: { ...input.period, weekStart: previousWeek, weekEndExclusive: week,
        startsAt: `${previousWeek}T00:00:00Z`, endsAtExclusive: `${week}T00:00:00Z` },
      previousDeliveryAt: previousDelivery, previousCapturedAt: previousCapture,
      currentComparedThrough: capture, previousComparedThrough: previousCapture };
    assert.notEqual(Date.parse(capture) - Date.parse(delivery),
      Date.parse(previousCapture) - Date.parse(previousDelivery));
    const result = projectV2(input, 'free').report;
    assert.equal(result.comparison.state, 'available');
    assert.equal(result.pillars.mind.changePoints.value, 3.5);
    // Removing the release-delay guard must not permit different account cutoffs.
    input.cutoffAt = input.capturedAt = new Date(Date.parse(capture) + 1).toISOString();
    input.comparison.currentComparedThrough = input.cutoffAt;
    assert.equal(projectV2(input, 'free').report.comparison.reason, 'observation_mismatch');
  });
}
