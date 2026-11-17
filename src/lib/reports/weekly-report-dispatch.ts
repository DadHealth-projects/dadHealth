import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { latestReleasedReportWeek } from './weekly-report-calendar';
import { buildPayload } from '@/lib/notifications/buildPayload';
import { sendRateLimitedNotification } from '@/lib/notifications/delivery';
import { persistInbox, readNotificationRows } from '@/lib/notifications/inbox';

type Admin = ReturnType<typeof createAdminSupabaseClient>;

/** No fallback zone: an invalid/missing account zone defers push only. */
export function weeklyPushTimeAllowed(now: Date, timezone: unknown): timezone is string {
  if (typeof timezone !== 'string' || !timezone.trim()) return false;
  try {
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', hourCycle: 'h23',
    }).format(now));
    return hour >= 8 && hour < 21;
  } catch { return false; }
}

/** Called by the existing authenticated dispatcher, independently of preferences.
 * Bounded, oldest-observed-first work selection is database-owned. Capture and
 * delivery are separate transactions: a provider failure cannot undo a report.
 */
export async function dispatchWeeklyReports(admin: Admin, now = new Date(), beforePush?: () => Promise<unknown>) {
  const week = latestReleasedReportWeek(now).weekStart;
  const totals = { reports: 0, sent: 0, pending: 0, errors: 0 };
  const candidates = await admin.rpc('list_item02_due_accounts', { p_week_start: week });
  if (candidates.error) throw candidates.error;
  const savedOwners: string[] = [];
  for (const account of candidates.data ?? []) {
    const owner = account.user_id as string;
    try {
      const capture = await admin.rpc('reconcile_and_capture_weekly_report', { p_user_id: owner, p_week_start: week });
      if (capture.error) throw capture.error;
      if (capture.data?.state !== 'available') {
        if (capture.data?.reason === 'capture_failed') totals.errors++; else totals.pending++;
        continue;
      }
      totals.reports++;
      savedOwners.push(owner);
    } catch { totals.errors++; continue; }
  }
  // Capture/attempt markers cannot hide a missing event after persistence failed.
  const activation = await admin.rpc('notification_inbox_started_at');
  if (activation.error) throw activation.error;
  const saved = await readNotificationRows<{
    user_id: string; reporting_week_start: string; delivery_at: string;
  }>((after, limit) => {
    let query = admin.from('weekly_report_snapshots')
      .select('user_id,reporting_week_start,delivery_at')
      .gte('captured_at', activation.data).lte('delivery_at', now.toISOString())
      .order('user_id', { ascending: true })
      .order('reporting_week_start', { ascending: true }).limit(limit);
    if (after) {
      query = query.or(`user_id.gt.${after.user_id},` +
        `and(user_id.eq.${after.user_id},reporting_week_start.gt.${after.reporting_week_start})`);
    }
    return query;
  });
  const reportKeys = new Map<string, { owner: string; week: string }>();
  for (const row of saved) reportKeys.set(`${row.user_id}:${row.reporting_week_start}`,{owner:row.user_id,week:row.reporting_week_start});
  const persisted: { owner: string; week: string }[] = [];
  for (const entry of reportKeys.values()) {
    try {
      await persistInbox(admin,entry.owner,`weekly-report:${entry.week}`,buildPayload({type:'weekly_score',reportingWeek:entry.week}));
      persisted.push(entry);
    } catch { totals.errors++; }
  }
  // Capture is independent of capacity; daily and trial reservations precede push.
  if (beforePush) await beforePush();
  for (const {owner,week} of persisted) {
    // Never gate the preceding capture on notification settings or timezone.
    try {
      const context = await admin.rpc('item03_notification_context', { p_user_id: owner });
      if (context.error) throw new Error('Notification settings unavailable');
      if (context.data?.allowed !== true) { totals.pending++; continue; }
      // Canonical effective timezone, not a profile change pending next Monday.
      // The shared claim independently checks the weekly preference and capacity.
      const result = await sendRateLimitedNotification({ admin, userId: owner, type: 'weekly_score',
        timezone: context.data.timezone, eventKey: `weekly-report:${week}`,
        payload: buildPayload({ type: 'weekly_score', reportingWeek: week }),
      });
      if (result === 'sent') totals.sent++; else totals.pending++;
    } catch { totals.errors++; }
  }
  return totals;
}
