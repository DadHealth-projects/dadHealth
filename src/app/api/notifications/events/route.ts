import { NextResponse } from "next/server";

import { sendOneSignalToExternalUserId } from "@/lib/notifications/onesignal";
import type { NotificationPayload } from "@/lib/notifications/types";
import type { NotificationType } from "@/types/database";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

type EventBody =
  | { type: "community_reply"; record_id: string; actor_user_id?: string | null }
  | { type: "co_parent_event_added"; record_id: string; actor_user_id?: string | null };

function isAuthorized(request: Request) {
  const expected = process.env.NOTIFICATION_WEBHOOK_SECRET?.trim();
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
}

async function sendIfAllowed(args: {
  admin: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  type: NotificationType;
  payload: NotificationPayload;
}) {
  const { admin, userId, type, payload } = args;
  const [profileResult, preferenceResult] = await Promise.all([
    admin.from("user_profile").select("push_notifications_enabled,timezone").eq("user_id", userId).maybeSingle(),
    admin.from("notification_preferences").select("enabled").eq("user_id", userId).eq("notification_type", type).maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (preferenceResult.error) throw preferenceResult.error;
  if (profileResult.data?.push_notifications_enabled !== true || preferenceResult.data?.enabled !== true) return "disabled";

  const logResult = await admin.rpc("log_notification_if_allowed", {
    p_user_id: userId,
    p_type: type,
    p_timezone: profileResult.data.timezone?.trim() || "UTC",
  });
  if (logResult.error) throw logResult.error;
  if (logResult.data !== true) return "limited";

  await sendOneSignalToExternalUserId({ externalUserId: userId, payload });
  return "sent";
}

async function communityReply(body: Extract<EventBody, { type: "community_reply" }>) {
  const admin = createAdminSupabaseClient();
  const commentResult = await admin.from("comments").select("id,user_id,post_id,parent_id").eq("id", body.record_id).maybeSingle();
  if (commentResult.error) throw commentResult.error;
  const comment = commentResult.data;
  if (!comment) return { sent: 0, skipped: 1 };

  const recipients = new Set<string>();
  if (comment.parent_id) {
    const parentResult = await admin.from("comments").select("user_id").eq("id", comment.parent_id).maybeSingle();
    if (parentResult.error) throw parentResult.error;
    if (parentResult.data?.user_id) recipients.add(parentResult.data.user_id);
  }

  const postResult = await admin.from("posts").select("user_id").eq("id", comment.post_id).maybeSingle();
  if (postResult.error) throw postResult.error;
  if (postResult.data?.user_id) recipients.add(postResult.data.user_id);
  else {
    const ownerResult = await admin.from("anonymous_post_owners").select("user_id").eq("post_id", comment.post_id).maybeSingle();
    if (ownerResult.error) throw ownerResult.error;
    if (ownerResult.data?.user_id) recipients.add(ownerResult.data.user_id);
  }

  recipients.delete(body.actor_user_id || comment.user_id);
  let sent = 0;
  let skipped = 0;
  for (const userId of recipients) {
    const result = await sendIfAllowed({
      admin,
      userId,
      type: "community_reply",
      payload: {
        type: "community_reply",
        heading: "New community reply",
        content: "Someone replied to your community post.",
        link: "/community",
        data: { post_id: comment.post_id, comment_id: comment.id },
      },
    });
    if (result === "sent") sent++;
    else skipped++;
  }
  return { sent, skipped };
}

async function coParentEvent(body: Extract<EventBody, { type: "co_parent_event_added" }>) {
  const admin = createAdminSupabaseClient();
  const eventResult = await admin.from("co_parenting_events").select("id,schedule_id,event_date,event_type").eq("id", body.record_id).maybeSingle();
  if (eventResult.error) throw eventResult.error;
  const event = eventResult.data;
  if (!event) return { sent: 0, skipped: 1 };
  const scheduleResult = await admin.from("co_parenting_schedules").select("user_id,co_parent_user_id").eq("id", event.schedule_id).maybeSingle();
  if (scheduleResult.error) throw scheduleResult.error;
  const schedule = scheduleResult.data;
  if (!schedule) return { sent: 0, skipped: 1 };

  const recipients = [schedule.user_id, schedule.co_parent_user_id].filter((id): id is string => Boolean(id && id !== body.actor_user_id));
  let sent = 0;
  let skipped = 0;
  for (const userId of recipients) {
    const result = await sendIfAllowed({
      admin,
      userId,
      type: "co_parent_event_added",
      payload: {
        type: "co_parent_event_added",
        heading: "Co-parent event added",
        content: "A new event was added to your shared calendar.",
        link: "/bond",
        data: { event_id: event.id, schedule_id: event.schedule_id, event_date: event.event_date },
      },
    });
    if (result === "sent") sent++;
    else skipped++;
  }
  return { sent, skipped };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as EventBody;
    if (!body?.record_id || (body.type !== "community_reply" && body.type !== "co_parent_event_added")) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }
    const result = body.type === "community_reply" ? await communityReply(body) : await coParentEvent(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[notifications/events]", error);
    return NextResponse.json({ error: "Event dispatch failed" }, { status: 500 });
  }
}
