import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { sendRateLimitedNotification } from './delivery';
import type { NotificationPayload } from './types';
import { readNotificationRows } from './inbox';

export const KICK_START_WORKOUT = '89e97b6c-0bfa-407d-a9f4-5020b086ba11';
/** Disabled until compatible installed clients are established. No version signal exists yet. */
export function exactPushEnabled() { return process.env.ITEM03_EXACT_PUSH_ENABLED === 'true'; }

export function pillarPayload(pillar: unknown): NotificationPayload | null {
  const destinations = {
    mind: ['Mind Reset', 'Take a five-minute Mind Reset.'],
    body: ['10 Minute kick-start', 'Make time for a 10 Minute kick-start.'],
    bond: ['Make time to connect', 'Explore Present Dad Mode.'],
  } as const;
  if (pillar !== 'mind' && pillar !== 'body' && pillar !== 'bond') return null;
  return { type: 'lowest_pillar', heading: destinations[pillar][0], content: destinations[pillar][1],
    link: pillar === 'mind' ? '/mind' : pillar === 'body' ? '/fitness' : '/bond',
    data: { destination_version: '1', pillar, ...(pillar === 'body' ? { workout_id: KICK_START_WORKOUT } : {}) } };
}

type Admin = ReturnType<typeof createAdminSupabaseClient>;
export async function dispatchItem03Notifications(admin: Admin) {
  const totals = { sent: 0, errors: 0 };
  // Eligibility/inbox discovery is independent of phone-alert consent/rollout.
  const accounts = await readNotificationRows<{ user_id: string }>((after, limit) => {
    let query = admin.from('user_profile').select('user_id')
      .order('user_id', { ascending: true }).limit(limit);
    if (after) query = query.gt('user_id', after.user_id);
    return query;
  });
  // Explicit priority: all eligible daily work, then trials. Weekly push follows in the dispatcher.
  for (const kind of ['daily', 'trial'] as const) {
    for (const account of accounts) {
      try {
        const result = await admin.rpc('item03_inbox_context', { p_user_id: account.user_id });
        if (result.error) throw result.error;
        const context = result.data;
        if (!context?.allowed) continue;
        if (kind === 'daily' && context.dailyType) {
          const payload: NotificationPayload | null = context.dailyType === 'morning_checkin'
            ? { type: 'morning_checkin', heading: 'Daily check-in', content: 'How are you feeling today?', link: '/', data: { destination_version: '1' } }
            : pillarPayload(context.pillar);
          if (payload && await sendRateLimitedNotification({ admin, userId: account.user_id,
            type: payload.type, timezone: context.timezone, eventKey: `daily:${context.date}`, payload }) === 'sent') totals.sent++;
        }
        if (kind === 'trial') for (const episode of context.trials ?? []) {
          const payload: NotificationPayload = { type: 'trial_ending', heading: 'Your Pro trial',
            content: 'Review your trial and plan details.', link: '/', data: { destination_version: '1', trial_episode: episode } };
          if (await sendRateLimitedNotification({ admin, userId: account.user_id, type: 'trial_ending',
            timezone: context.timezone, eventKey: `trial:${episode}`, payload }) === 'sent') totals.sent++;
        }
      } catch { totals.errors++; }
    }
  }
  return totals;
}
