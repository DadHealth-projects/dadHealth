/** Pure contract/projection only. No reads, scheduling, scoring or access resolution. */
export const WEEKLY_REPORT_VERSION = 1 as const;
export const TREND_FALLBACK = 'Building first 7 day trend' as const;
export const REPORT_DELIVERY = { weekday: 'Sunday', time: '18:00', timeZone: 'Europe/London' } as const;

export type Measurement =
  | { state: 'available'; value: number }
  | { state: 'missing' | 'unavailable' };
export type Pillar = 'mind' | 'body' | 'bond';
export interface ReportPeriod {
  /** Account-calendar date keys, Monday inclusive to next Monday exclusive. */
  weekStart: string;
  weekEndExclusive: string;
  /** Absolute boundaries supplied by the canonical scoring calendar. */
  startsAt: string;
  endsAtExclusive: string;
  accountTimezone: string;
  scoringModel: string;
}

export type ComparisonInput =
  | { state: 'unavailable'; reason: 'missing_history' | 'incomplete_history' | 'policy_unapproved' | 'data_unavailable' }
  | {
    state: 'available';
    previousPeriod: ReportPeriod;
    previousWeekComplete: boolean;
    /** Caller must supply an approved policy; this module does not choose one. */
    policy: 'partial_week_vs_full_week' | 'matched_cutoff' | 'full_week_vs_full_week';
    policyApproved: boolean;
    currentComparedThrough: string;
    previousComparedThrough: string;
  };
export interface WeeklyReportInput {
  version: typeof WEEKLY_REPORT_VERSION;
  period: ReportPeriod;
  /** Sunday 18:00 London deadline, separate from account-calendar boundaries. */
  deliveryAt: string;
  /** Explicit data cutoff; may precede delivery for an already-ended account week. */
  cutoffAt: string;
  comparison: ComparisonInput;
  pillars: Record<Pillar, { score: Measurement; changePoints: Measurement }>;
  details: {
    workouts: Measurement;
    bondSessions: Measurement;
    checkins: Measurement;
    streak: { days: Measurement; protectedDates: string[] };
    narrative: string | null;
    focus: { pillar: Pillar; action: string; text: string } | null;
  };
}
export type ReportAccess = 'free' | 'pro' | 'unknown' | 'failed';
type ComparisonOutput = ComparisonInput | { state: 'unavailable'; reason: 'model_mismatch' | 'calendar_mismatch' };
export interface ReportHeadline {
  version: typeof WEEKLY_REPORT_VERSION;
  period: ReportPeriod;
  delivery: typeof REPORT_DELIVERY;
  deliveryAt: string;
  cutoffAt: string;
  comparison: ComparisonOutput;
  pillars: Record<Pillar, { score: Measurement; changePoints: Measurement; trendMessage: typeof TREND_FALLBACK | null }>;
}
export type WeeklyReportResponse =
  | { access: 'unknown' | 'failed'; report: null }
  | { access: 'free'; report: ReportHeadline }
  | { access: 'pro'; report: ReportHeadline & { details: WeeklyReportInput['details'] } };

function instant(value: string): number {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid report timestamp');
  return Date.parse(value);
}
function period(input: ReportPeriod): ReportPeriod {
  const start = new Date(`${input.weekStart}T00:00:00Z`);
  const end = new Date(`${input.weekEndExclusive}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
    || start.toISOString().slice(0, 10) !== input.weekStart || end.toISOString().slice(0, 10) !== input.weekEndExclusive
    || start.getUTCDay() !== 1 || end.getTime() - start.getTime() !== 7 * 86400000
    || instant(input.startsAt) >= instant(input.endsAtExclusive) || !input.scoringModel.trim()) throw new Error('Invalid report period');
  new Intl.DateTimeFormat('en-GB', { timeZone: input.accountTimezone }).format(start);
  return { weekStart: input.weekStart, weekEndExclusive: input.weekEndExclusive,
    startsAt: input.startsAt, endsAtExclusive: input.endsAtExclusive,
    accountTimezone: input.accountTimezone, scoringModel: input.scoringModel };
}
function measurement(input: Measurement, kind: 'score' | 'change' | 'count'): Measurement {
  if (input.state === 'missing' || input.state === 'unavailable') return { state: input.state };
  if (input.state !== 'available' || !Number.isFinite(input.value)
    || (kind === 'score' && (input.value < 0 || input.value > 100))
    || (kind === 'change' && Math.abs(input.value) > 100)
    || (kind === 'count' && (!Number.isInteger(input.value) || input.value < 0))) throw new Error('Invalid report measurement');
  return { state: 'available', value: input.value };
}
function comparison(input: ComparisonInput, current: ReportPeriod, cutoffAt: string): ComparisonOutput {
  if (input.state === 'unavailable') return { state: 'unavailable', reason: input.reason };
  if (!input.policyApproved) return { state: 'unavailable', reason: 'policy_unapproved' };
  const previous = period(input.previousPeriod);
  if (previous.scoringModel !== current.scoringModel) return { state: 'unavailable', reason: 'model_mismatch' };
  if (previous.weekEndExclusive !== current.weekStart || previous.accountTimezone !== current.accountTimezone) {
    return { state: 'unavailable', reason: 'calendar_mismatch' };
  }
  if (!input.previousWeekComplete) return { state: 'unavailable', reason: 'incomplete_history' };
  const through = instant(input.currentComparedThrough), priorThrough = instant(input.previousComparedThrough);
  if (through !== instant(cutoffAt) || priorThrough <= instant(previous.startsAt) || priorThrough > instant(previous.endsAtExclusive)) {
    throw new Error('Invalid comparison cutoff');
  }
  return { state: 'available', previousPeriod: previous, previousWeekComplete: true,
    policy: input.policy, policyApproved: true, currentComparedThrough: input.currentComparedThrough,
    previousComparedThrough: input.previousComparedThrough };
}

/** Access is an authoritative caller input, never inferred from report contents. */
export function projectWeeklyReport(input: WeeklyReportInput, access: ReportAccess): WeeklyReportResponse {
  if (access !== 'free' && access !== 'pro') return { access: access === 'failed' ? 'failed' : 'unknown', report: null };
  if (input.version !== WEEKLY_REPORT_VERSION) throw new Error('Unsupported report version');
  const current = period(input.period);
  const deliveryTime = instant(input.deliveryAt), cutoff = instant(input.cutoffAt);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: REPORT_DELIVERY.timeZone,
    weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(deliveryTime));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  if (part('weekday') !== 'Sunday' || part('hour') !== '18' || part('minute') !== '00' || part('second') !== '00'
    || deliveryTime % 1000 !== 0 || cutoff > deliveryTime
    || cutoff <= instant(current.startsAt) || cutoff > instant(current.endsAtExclusive)) throw new Error('Invalid report cutoff or delivery');
  const compared = comparison(input.comparison, current, input.cutoffAt);
  const pillar = (key: Pillar) => {
    const score = measurement(input.pillars[key].score, 'score');
    const suppliedChange = measurement(input.pillars[key].changePoints, 'change');
    const changePoints: Measurement = compared.state === 'available' && score.state === 'available'
      ? suppliedChange : { state: 'unavailable' };
    return { score, changePoints, trendMessage: changePoints.state === 'available' ? null : TREND_FALLBACK };
  };
  const report: ReportHeadline = { version: WEEKLY_REPORT_VERSION, period: current,
    delivery: { ...REPORT_DELIVERY }, deliveryAt: input.deliveryAt, cutoffAt: input.cutoffAt, comparison: compared,
    pillars: { mind: pillar('mind'), body: pillar('body'), bond: pillar('bond') } };
  if (access === 'free') return { access: 'free', report };
  const detail = input.details;
  return { access: 'pro', report: { ...report, details: {
    workouts: measurement(detail.workouts, 'count'), bondSessions: measurement(detail.bondSessions, 'count'),
    checkins: measurement(detail.checkins, 'count'),
    streak: { days: measurement(detail.streak.days, 'count'), protectedDates: [...detail.streak.protectedDates] },
    narrative: detail.narrative,
    focus: detail.focus ? { pillar: detail.focus.pillar, action: detail.focus.action, text: detail.focus.text } : null,
  } } };
}

/** V2 records when data was observed, independently of the scheduled release.
 * V1 remains unchanged for existing callers and saved contracts.
 */
export const WEEKLY_REPORT_VERSION_V2 = 2 as const;
type AvailableComparison = Extract<ComparisonInput, { state: 'available' }>;
export type ComparisonInputV2 =
  | { state: 'unavailable'; reason: Extract<ComparisonInput, { state: 'unavailable' }>['reason']
      | 'snapshot_missing' | 'observation_mismatch' | 'model_mismatch' | 'calendar_mismatch' }
  | (AvailableComparison & { previousCapturedAt: string; previousDeliveryAt: string });
export interface WeeklyReportInputV2 extends Omit<WeeklyReportInput, 'version' | 'comparison'> {
  version: typeof WEEKLY_REPORT_VERSION_V2;
  capturedAt: string;
  comparison: ComparisonInputV2;
}
export interface ReportHeadlineV2 extends Omit<ReportHeadline, 'version' | 'comparison'> {
  version: typeof WEEKLY_REPORT_VERSION_V2;
  capturedAt: string;
  comparison: ComparisonInputV2;
}
export type WeeklyReportResponseV2 =
  | { access: 'unknown' | 'failed'; report: null }
  | { access: 'free'; report: ReportHeadlineV2 }
  | { access: 'pro'; report: ReportHeadlineV2 & { details: WeeklyReportInput['details'] } };

function isLondonRelease(value: string): boolean {
  const time = instant(value);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London',
    weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return part('weekday') === 'Sunday' && part('hour') === '18' && part('minute') === '00'
    && part('second') === '00' && time % 1000 === 0;
}

function calendarOffset(value: string, basis: ReportPeriod): number {
  const time = instant(value);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: basis.accountTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time));
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
    + ((time % 1000) + 1000) % 1000 - Date.parse(`${basis.weekStart}T00:00:00Z`);
}

function comparisonV2(input: WeeklyReportInputV2, current: ReportPeriod): ComparisonInputV2 {
  const candidate = input.comparison;
  if (candidate.state === 'unavailable') {
    if (!['missing_history', 'incomplete_history', 'policy_unapproved', 'data_unavailable',
      'snapshot_missing', 'observation_mismatch', 'model_mismatch', 'calendar_mismatch'].includes(candidate.reason)) {
      throw new Error('Invalid comparison reason');
    }
    return { state: 'unavailable', reason: candidate.reason };
  }
  if (candidate.state !== 'available' || !['matched_cutoff', 'full_week_vs_full_week', 'partial_week_vs_full_week'].includes(candidate.policy)) {
    throw new Error('Invalid comparison policy');
  }
  const checked = comparison(candidate, current, input.cutoffAt);
  if (checked.state === 'unavailable') return checked;
  const previous = checked.previousPeriod;
  const previousCapture = instant(candidate.previousCapturedAt);
  const previousRelease = instant(candidate.previousDeliveryAt);
  const previousCutoff = instant(candidate.previousComparedThrough);
  if (!isLondonRelease(candidate.previousDeliveryAt) || previousCapture < previousRelease
    || new Date(previousRelease).toISOString().slice(0, 10)
      !== new Date(Date.parse(`${previous.weekStart}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10)
    || previousCutoff !== Math.min(previousCapture, instant(previous.endsAtExclusive))) {
    throw new Error('Invalid previous observation');
  }
  const currentComplete = instant(input.cutoffAt) === instant(current.endsAtExclusive);
  const previousComplete = previousCutoff === instant(previous.endsAtExclusive);
  // No guessed tolerance. Equal release lateness alone is insufficient across
  // account/UK DST differences; both the local cutoff and observation must match.
  if (candidate.policy === 'partial_week_vs_full_week'
    || (candidate.policy === 'full_week_vs_full_week' && (!currentComplete || !previousComplete))
    || currentComplete !== previousComplete
    || calendarOffset(input.cutoffAt, current) !== calendarOffset(candidate.previousComparedThrough, previous)
    || calendarOffset(input.capturedAt, current) !== calendarOffset(candidate.previousCapturedAt, previous)) {
    return { state: 'unavailable', reason: 'observation_mismatch' };
  }
  return { ...checked, previousCapturedAt: candidate.previousCapturedAt, previousDeliveryAt: candidate.previousDeliveryAt };
}

/** Explicit allowlists at every level; failed entitlement resolution exposes nothing. */
export function projectWeeklyReportV2(input: WeeklyReportInputV2, access: ReportAccess): WeeklyReportResponseV2 {
  if (access !== 'free' && access !== 'pro') return { access: access === 'failed' ? 'failed' : 'unknown', report: null };
  if (input.version !== WEEKLY_REPORT_VERSION_V2) throw new Error('Unsupported report version');
  const current = period(input.period);
  const captured = instant(input.capturedAt);
  if (!isLondonRelease(input.deliveryAt) || captured < instant(input.deliveryAt)
    || instant(input.cutoffAt) !== Math.min(captured, instant(current.endsAtExclusive))
    || instant(input.cutoffAt) <= instant(current.startsAt)) throw new Error('Invalid report observation');
  // The release Sunday's London date must belong to the labelled Monday-Sunday week.
  const releaseDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(input.deliveryAt));
  const key = (type: string) => releaseDate.find(p => p.type === type)!.value;
  if (Date.parse(`${key('year')}-${key('month')}-${key('day')}T00:00:00Z`)
    !== Date.parse(`${current.weekStart}T00:00:00Z`) + 6 * 86400000) throw new Error('Invalid release week');
  const compared = comparisonV2(input, current);
  const insufficientHistory = compared.state === 'unavailable'
    && (compared.reason === 'missing_history' || compared.reason === 'incomplete_history');
  const pillar = (name: Pillar) => {
    const score = measurement(input.pillars[name].score, 'score');
    const supplied = measurement(input.pillars[name].changePoints, 'change');
    const changePoints: Measurement = compared.state === 'available' && score.state === 'available'
      ? supplied : { state: 'unavailable' };
    return { score, changePoints, trendMessage: insufficientHistory ? TREND_FALLBACK : null };
  };
  const report: ReportHeadlineV2 = { version: WEEKLY_REPORT_VERSION_V2, period: current,
    delivery: { ...REPORT_DELIVERY }, deliveryAt: input.deliveryAt, cutoffAt: input.cutoffAt,
    capturedAt: input.capturedAt, comparison: compared,
    pillars: { mind: pillar('mind'), body: pillar('body'), bond: pillar('bond') } };
  if (access === 'free') return { access: 'free', report };
  const detail = input.details;
  return { access: 'pro', report: { ...report, details: {
    workouts: measurement(detail.workouts, 'count'), bondSessions: measurement(detail.bondSessions, 'count'),
    checkins: measurement(detail.checkins, 'count'),
    streak: { days: measurement(detail.streak.days, 'count'), protectedDates: [...detail.streak.protectedDates] },
    narrative: detail.narrative,
    focus: detail.focus ? { pillar: detail.focus.pillar, action: detail.focus.action, text: detail.focus.text } : null,
  } } };
}
