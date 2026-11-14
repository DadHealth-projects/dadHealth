import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { latestReleasedReportWeek, reportReleaseForWeek } from './weekly-report-calendar';
import { projectWeeklyReportV2, type WeeklyReportInputV2, type WeeklyReportResponseV2 } from './weekly-report';

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;
export type ReportReadResult =
  | { state: 'available'; result: WeeklyReportResponseV2 }
  | { state: 'unavailable'; reason: 'not_released' | 'snapshot_missing' | 'entitlement_unavailable' | 'read_failed' | 'invalid_snapshot' };

/** No generation on GET. The owner must come from verified server authentication. */
export async function readWeeklyReport(admin: AdminClient, owner: string, week?: string, now = new Date()): Promise<ReportReadResult> {
  const release = week ? reportReleaseForWeek(week) : latestReleasedReportWeek(now);
  // Reuse the canonical database predicate, including manual/legacy grants.
  // Unlike coercing a missing result to false, require an actual boolean.
  const { data: access, error: accessError } = await admin.rpc('user_has_pro_access', { p_user_id: owner });
  if (accessError || typeof access !== 'boolean') return { state: 'unavailable', reason: 'entitlement_unavailable' };
  if (now.getTime() < Date.parse(release.deliveryAt)) return { state: 'unavailable', reason: 'not_released' };
  const { data, error } = await admin.from('weekly_report_snapshots')
    .select('user_id,reporting_week_start,delivery_at,captured_at,payload')
    .eq('user_id', owner).eq('reporting_week_start', release.weekStart).maybeSingle();
  if (error) return { state: 'unavailable', reason: 'read_failed' };
  if (!data) return { state: 'unavailable', reason: 'snapshot_missing' };
  // Validate persisted metadata before projection; never send the raw stored JSON.
  try {
    const input = data.payload as WeeklyReportInputV2;
    if (data.user_id !== owner || data.reporting_week_start !== release.weekStart
      || input.period.weekStart !== release.weekStart
      || Date.parse(data.delivery_at) !== Date.parse(release.deliveryAt)
      || Date.parse(input.deliveryAt) !== Date.parse(data.delivery_at)
      || Date.parse(input.capturedAt) !== Date.parse(data.captured_at)
      || Date.parse(input.capturedAt) > now.getTime()) throw new Error('Invalid snapshot metadata');
    return { state: 'available', result: projectWeeklyReportV2(input, access ? 'pro' : 'free') };
  } catch {
    return { state: 'unavailable', reason: 'invalid_snapshot' };
  }
}
