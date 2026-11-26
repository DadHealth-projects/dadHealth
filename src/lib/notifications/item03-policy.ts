import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { sendRateLimitedNotification } from './delivery';
import type { NotificationPayload } from './types';
import { readNotificationRows } from './inbox';

export const KICK_START_WORKOUT = '89e97b6c-0bfa-407d-a9f4-5020b086ba11';
/** Disabled until compatible installed clients are established. No version signal exists yet. */
export function exactPushEnabled() { return process.env.ITEM03_EXACT_PUSH_ENABLED === 'true'; }

export function pillarPayload(pillar: unknown): NotificationPayload | null {
  // Brief 03 tone: warm and short, e.g. "Tough week for Bond. Here's one small thing to try today."
  const destinations = {
    mind: ['Tough week for Mind', "Here's one small thing to try today: a five-minute Mind Reset."],
    body: ['Tough week for Body', "Here's one small thing to try today: the 10 Minute Kick-Start."],
    bond: ['Tough week for Bond', "Here's one small thing to try today: some time in Present Dad Mode."],
  } as const;
  if (pillar !== 'mind' && pillar !== 'body' && pillar !== 'bond') return null;
  return { type: 'lowest_pillar', heading: destinations[pillar][0], content: destinations[pillar][1],
    link: pillar === 'mind' ? '/mind' : pillar === 'body' ? '/fitness' : '/bond',
    data: { destination_version: '1', pillar, ...(pillar === 'body' ? { workout_id: KICK_START_WORKOUT } : {}) } };
}

type Admin = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Brief 01 day-5 notice. The agreed wording "Your trial ends in 2 days" is sent only while it is
 * true for the verified trial end: 36-84 hours left (a 7-day trial reaches day 5 with 72 hours left).
 * A delayed run, a retry or a late push rollout outside that window sends nothing rather than a
 * wrong countdown. Expired, cancelled and converted trials are already excluded by item03_inbox_context.
 */
export const TRIAL_REMINDER_MIN_HOURS = 36;
export const TRIAL_REMINDER_MAX_HOURS = 84;
export function trialReminderDue(endsAt: unknown, now = Date.now()) {
  const end = typeof endsAt === 'string' ? Date.parse(endsAt) : Number.NaN;
  if (!Number.isFinite(end)) return false;
  const hoursLeft = (end - now) / 3_600_000;
  return hoursLeft >= TRIAL_REMINDER_MIN_HOURS && hoursLeft <= TRIAL_REMINDER_MAX_HOURS;
}
/** Verified end times for this member's eligible episodes, read just before sending. */
async function trialEndsFor(admin: Admin, userId: string, ids: string[]) {
  const { data, error } = await admin.from('notification_trial_episodes').select('id,ends_at').eq('user_id', userId).in('id', ids);
  if (error) throw error;
  return new Map(((data ?? []) as Array<{ id: string; ends_at: string }>).map((row) => [row.id, row.ends_at]));
}
/** Shape returned by item03_inbox_context (see the notification migrations). */
type Item03Context = { allowed?: boolean; timezone: string; date: string; dailyType?: string | null; pillar?: unknown; trials?: string[] };
export async function dispatchItem03Notifications(admin: Admin) {
  const totals = { sent: 0, errors: 0 };
  // Eligibility/inbox discovery is independent of phone-alert consent/rollout.
  const accounts = await readNotificationRows<{ user_id: string }>((after, limit) => {
    let query = admin.from('user_profile').select('user_id')
      .order('user_id', { ascending: true }).limit(limit);
    if (after) query = query.gt('user_id', after.user_id);
    return query;
  });
  // One context read per account per run (it was read once per pass, doubling the
  // database work). A failed read still counts once per pass, as before.
  const contexts = new Map<string, Promise<Item03Context | null>>();
  const contextFor = (userId: string) => {
    let pending = contexts.get(userId);
    if (!pending) {
      pending = Promise.resolve(admin.rpc('item03_inbox_context', { p_user_id: userId })).then((result) => {
        if (result.error) throw result.error;
        return result.data as Item03Context | null;
      });
      pending.catch(() => undefined);
      contexts.set(userId, pending);
    }
    return pending;
  };
  // Explicit priority: all eligible daily work, then trials. Weekly push follows in the dispatcher.
  for (const kind of ['daily', 'trial'] as const) {
    for (const account of accounts) {
      try {
        const context = await contextFor(account.user_id);
        if (!context?.allowed) continue;
        if (kind === 'daily' && context.dailyType) {
          const payload: NotificationPayload | null = context.dailyType === 'morning_checkin'
            ? { type: 'morning_checkin', heading: 'Daily check-in', content: 'How are you doing today? It takes a few seconds.', link: '/', data: { destination_version: '1' } }
            : pillarPayload(context.pillar);
          if (payload && await sendRateLimitedNotification({ admin, userId: account.user_id,
            type: payload.type, timezone: context.timezone, eventKey: `daily:${context.date}`, payload }) === 'sent') totals.sent++;
        }
        const trials = kind === 'trial' ? context.trials ?? [] : [];
        const endsAt = trials.length ? await trialEndsFor(admin, account.user_id, trials) : null;
        for (const episode of trials) {
          if (!trialReminderDue(endsAt?.get(episode))) continue;
          // Brief 01: "Day 5 notification: your trial ends in 2 days."
          const payload: NotificationPayload = { type: 'trial_ending', heading: 'Your trial ends in 2 days',
            content: 'Keep Pro, or review your plan. Cancel anytime before then.', link: '/', data: { destination_version: '1', trial_episode: episode } };
          if (await sendRateLimitedNotification({ admin, userId: account.user_id, type: 'trial_ending',
            timezone: context.timezone, eventKey: `trial:${episode}`, payload }) === 'sent') totals.sent++;
        }
      } catch { totals.errors++; }
    }
  }
  return totals;
}
