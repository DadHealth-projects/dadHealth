import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { latestReleasedReportWeek, reportReleaseForWeek } from './weekly-report-calendar';
import { projectWeeklyReportV2, type WeeklyReportInputV2, type WeeklyReportResponseV2 } from './weekly-report';

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;
export type ReportReadResult =
  | { state: 'available'; result: WeeklyReportResponseV2 }
  | { state: 'unavailable'; reason: 'not_released' | 'snapshot_missing' | 'entitlement_unavailable' | 'read_failed' | 'invalid_snapshot' };
type Release = ReturnType<typeof reportReleaseForWeek>;
type SnapshotRow = { user_id: string; reporting_week_start: string; delivery_at: string; captured_at: string; payload: any };
type PriorReader = (weekStart: string) => Promise<{ data: SnapshotRow | null; error: unknown }>;

const SNAPSHOT_FIELDS = 'user_id,reporting_week_start,delivery_at,captured_at,payload';
// Only "the function is not installed yet" selects the earlier three-call path. Every other
// failure of the single read fails closed: access is unknown, so nothing is shown.
const SINGLE_READ_NOT_INSTALLED = new Set(['PGRST202', '42883']);
// While the function is not installed, skip the failed extra round trip on every read: this
// server instance re-checks at most every 5 minutes, then uses the single read once it exists.
const SINGLE_READ_RECHECK_MS = 5 * 60_000;
let singleReadMissingUntil = 0;
/** Test hook: forget a remembered "not installed" answer. */
export function resetWeeklyReportSingleReadProbe() { singleReadMissingUntil = 0; }

/**
 * No generation on GET. The owner must come from verified server authentication.
 * One database call (`read_weekly_report_rows`) decides access first and only then reads the
 * owner's current and prior saved snapshots, so no snapshot is read before access is known.
 */
export async function readWeeklyReport(admin: AdminClient, owner: string, week?: string, now = new Date()): Promise<ReportReadResult> {
  const release = week ? reportReleaseForWeek(week) : latestReleasedReportWeek(now);
  if (Date.now() < singleReadMissingUntil) return readWeeklyReportSequential(admin, owner, week, now);
  const { data, error } = await admin.rpc('read_weekly_report_rows', {
    p_user_id: owner, p_week: week ? release.weekStart : null, p_now: now.toISOString(),
  });
  if (error && SINGLE_READ_NOT_INSTALLED.has(String((error as { code?: unknown }).code ?? ''))) {
    singleReadMissingUntil = Date.now() + SINGLE_READ_RECHECK_MS;
    return readWeeklyReportSequential(admin, owner, week, now);
  }
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return { state: 'unavailable', reason: 'entitlement_unavailable' };
  const rows = data as { access?: unknown; current?: SnapshotRow | null; prior?: SnapshotRow | null };
  // Unlike coercing a missing result to false, require an actual boolean.
  if (typeof rows.access !== 'boolean') return { state: 'unavailable', reason: 'entitlement_unavailable' };
  if (now.getTime() < Date.parse(release.deliveryAt)) return { state: 'unavailable', reason: 'not_released' };
  if (!rows.current) return { state: 'unavailable', reason: 'snapshot_missing' };
  const prior = rows.prior ?? null;
  return projectSnapshot(owner, week, release, now, rows.access, rows.current,
    async weekStart => ({ data: prior && prior.reporting_week_start === weekStart ? prior : null, error: null }));
}

/** The earlier path, used only until the single-read function is installed. Same order: access, then reads. */
async function readWeeklyReportSequential(admin: AdminClient, owner: string, week: string | undefined, now: Date): Promise<ReportReadResult> {
  const release = week ? reportReleaseForWeek(week) : latestReleasedReportWeek(now);
  // Reuse the canonical database predicate, including manual/legacy grants.
  const { data: access, error: accessError } = await admin.rpc('user_has_pro_access', { p_user_id: owner });
  if (accessError || typeof access !== 'boolean') return { state: 'unavailable', reason: 'entitlement_unavailable' };
  if (now.getTime() < Date.parse(release.deliveryAt)) return { state: 'unavailable', reason: 'not_released' };
  let query = admin.from('weekly_report_snapshots').select(SNAPSHOT_FIELDS).eq('user_id', owner);
  query = week ? query.eq('reporting_week_start', release.weekStart)
    : query.lte('delivery_at', now.toISOString()).order('reporting_week_start', { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) return { state: 'unavailable', reason: 'read_failed' };
  if (!data) return { state: 'unavailable', reason: 'snapshot_missing' };
  return projectSnapshot(owner, week, release, now, access, data as SnapshotRow,
    async weekStart => await admin.from('weekly_report_snapshots').select(SNAPSHOT_FIELDS)
      .eq('user_id', owner).eq('reporting_week_start', weekStart).maybeSingle() as { data: SnapshotRow | null; error: unknown });
}

function projectSnapshot(owner: string, week: string | undefined, requested: Release, now: Date, access: boolean,
  data: SnapshotRow, readPrior: PriorReader): Promise<ReportReadResult> | ReportReadResult {
  // Validate persisted metadata before projection; never send the raw stored JSON.
  try {
    const release = week ? requested : reportReleaseForWeek(data.reporting_week_start);
    const input = data.payload as WeeklyReportInputV2;
    if (data.user_id !== owner || data.reporting_week_start !== release.weekStart
      || input.period.weekStart !== release.weekStart
      || Date.parse(data.delivery_at) !== Date.parse(release.deliveryAt)
      || Date.parse(input.deliveryAt) !== Date.parse(data.delivery_at)
      || Date.parse(input.capturedAt) !== Date.parse(data.captured_at)
      || Date.parse(input.capturedAt) > now.getTime()) throw new Error('Invalid snapshot metadata');
    const projection = projectWeeklyReportV2(input, access ? 'pro' : 'free');
    if (projection.report?.comparison.state !== 'available') return { state: 'available', result: projection };
    const previousWeek = projection.report.comparison.previousPeriod.weekStart;
    return withPrior(owner, input, access, projection, previousWeek, readPrior);
  } catch {
    return { state: 'unavailable', reason: 'invalid_snapshot' };
  }
}

async function withPrior(owner: string, input: WeeklyReportInputV2, access: boolean, projection: WeeklyReportResponseV2,
  previousWeek: string, readPrior: PriorReader): Promise<ReportReadResult> {
  // Failure to read a prior snapshot must not hide the current saved report.
  try {
    const { data: prior, error: priorError } = await readPrior(previousWeek);
    if (!priorError && prior?.user_id === owner
      && prior.reporting_week_start === previousWeek
      && prior.payload?.period?.weekStart === prior.reporting_week_start
      && Date.parse(prior.delivery_at) === Date.parse(prior.payload.deliveryAt)
      && Date.parse(prior.captured_at) === Date.parse(prior.payload.capturedAt)) {
      return { state: 'available', result: projectWeeklyReportV2(input, access ? 'pro' : 'free', prior.payload) };
    }
  } catch { /* Keep the current report; only the overall change is unavailable. */ }
  return { state: 'available', result: projection };
}
