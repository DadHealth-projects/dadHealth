import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
import type { NotificationPayload } from './types';

export async function readNotificationRows<Row>(
  readPage: (
    after: Row | null,
    limit: number,
  ) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  let after: Row | null = null;
  for (;;) {
    const result = await readPage(after, 100);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    if (page.length === 0) return rows;
    const next = page[page.length - 1];
    if (after !== null && JSON.stringify(next) === JSON.stringify(after)) {
      throw new Error('Notification pagination did not advance');
    }
    rows.push(...page);
    after = next;
  }
}

type Admin = ReturnType<typeof createAdminSupabaseClient>;
export type InboxEvent = {
  id: string; user_id: string; type: NotificationPayload['type']; source_key: string;
  title: string; description: string; destination: Record<string, string>;
};
export async function persistInbox(admin: Admin, userId: string, sourceKey: string, payload: NotificationPayload): Promise<InboxEvent | null> {
  if (payload.type === 'streak_at_risk') return null;
  const result = await admin.rpc('ensure_notification_inbox_event', {
    p_user_id: userId, p_type: payload.type, p_source_key: sourceKey,
    p_title: payload.heading, p_description: payload.content,
    p_destination: { ...payload.data, version: '1', type: payload.type, link: payload.link },
  });
  if (result.error) throw result.error;
  if (!result.data) return null;
  if (result.data.user_id !== userId || typeof result.data.id !== 'string') throw new Error('Invalid inbox receipt');
  return result.data as InboxEvent;
}
export function savedInboxPayload(event: InboxEvent): NotificationPayload {
  const { version: _version, type: _type, link, ...data } = event.destination;
  return { type: event.type, heading: event.title, content: event.description,
    link: link as NotificationPayload['link'], data: { ...data, inbox_event_id: event.id } };
}
