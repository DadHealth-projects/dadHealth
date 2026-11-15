import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { latestReleasedReportWeek } from './weekly-report-calendar';
import { buildPayload } from '@/lib/notifications/buildPayload';
import { sendRateLimitedNotification } from '@/lib/notifications/delivery';

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
export async function dispatchWeeklyReports(admin: Admin, now = new Date()) {
  const week = latestReleasedReportWeek(now).weekStart;
  const totals = { reports: 0, sent: 0, pending: 0, errors: 0 };
  const candidates = await admin.rpc('list_item02_due_accounts', { p_week_start: week });
  if (candidates.error) throw candidates.error;
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
    } catch { totals.errors++; continue; }

    // Never gate the preceding capture on notification settings or timezone.
    try {
      const [profile, preference] = await Promise.all([
        admin.from('user_profile').select('timezone,push_notifications_enabled').eq('user_id', owner).maybeSingle(),
        admin.from('notification_preferences').select('enabled').eq('user_id', owner).eq('notification_type', 'weekly_score').maybeSingle(),
      ]);
      if (profile.error || preference.error) throw new Error('Notification settings unavailable');
      if (profile.data?.push_notifications_enabled !== true || preference.data?.enabled !== true
        || !weeklyPushTimeAllowed(now, profile.data?.timezone)) { totals.pending++; continue; }
      const result = await sendRateLimitedNotification({ admin, userId: owner, type: 'weekly_score',
        timezone: profile.data.timezone, eventKey: `weekly-report:${week}`,
        payload: buildPayload({ type: 'weekly_score', reportingWeek: week }),
      });
      if (result === 'sent') totals.sent++; else totals.pending++;
    } catch { totals.errors++; }
  }
  return totals;
}
