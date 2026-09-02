import { NextResponse } from "next/server";

import { sendRateLimitedNotification } from "@/lib/notifications/delivery";
import type { NotificationPayload } from "@/lib/notifications/types";
import type { NotificationType } from "@/types/database";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

type EventBody =
  | {
      type: "community_reply";
      record_id: string;
      actor_user_id?: string | null;
    }
  | {
      type: "community_like";
      record_id: string;
      actor_user_id?: string | null;
      target_type: "post" | "comment";
    }
  | {
      type: "co_parent_event_added";
      record_id: string;
      actor_user_id?: string | null;
    };

function isAuthorized(request: Request) {
  const expected = process.env.NOTIFICATION_WEBHOOK_SECRET?.trim();
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
}

async function sendIfAllowed(args: {
  admin: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  type: NotificationType;
  eventKey: string;
  payload: NotificationPayload;
}) {
  const { admin, userId, type, eventKey, payload } = args;
  const [profileResult, preferenceResult] = await Promise.all([
    admin.from("user_profile").select("push_notifications_enabled,timezone").eq("user_id", userId).maybeSingle(),
    admin.from("notification_preferences").select("enabled").eq("user_id", userId).eq("notification_type", type).maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (preferenceResult.error) throw preferenceResult.error;
  if (profileResult.data?.push_notifications_enabled !== true || preferenceResult.data?.enabled !== true) {
    console.info("[notifications/events] Recipient settings skipped delivery", {
      user: userId.slice(0, 8),
      type,
      masterEnabled: profileResult.data?.push_notifications_enabled === true,
      typeEnabled: preferenceResult.data?.enabled === true,
    });
    return "disabled";
  }

  return sendRateLimitedNotification({
    admin,
    userId,
    type,
    timezone: profileResult.data.timezone?.trim() || "UTC",
    eventKey,
    payload,
  });
}

async function actorName(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string | null | undefined) {
  if (!userId) return "Someone";
  const result = await admin.from("user_profile").select("display_name").eq("user_id", userId).maybeSingle();
  if (result.error) throw result.error;
  if (result.data?.display_name?.trim()) return result.data.display_name.trim();
  const authResult = await admin.auth.admin.getUserById(userId);
  if (authResult.error) throw authResult.error;
  const metadata = authResult.data.user?.user_metadata as Record<string, unknown> | undefined;
  const fallback = [metadata?.display_name, metadata?.full_name, metadata?.name]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return fallback?.trim() || authResult.data.user?.email?.split("@")[0]?.trim() || "Someone";
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
  const name = await actorName(admin, body.actor_user_id || comment.user_id);

  recipients.delete(body.actor_user_id || comment.user_id);
  console.info("[notifications/events] Community recipients resolved", {
    record: comment.id.slice(0, 8),
    recipients: recipients.size,
    isThreadReply: Boolean(comment.parent_id),
  });
  let sent = 0;
  let skipped = 0;
  for (const userId of recipients) {
    const result = await sendIfAllowed({
      admin,
      userId,
      type: "community_reply",
      eventKey: comment.id,
      payload: {
  type: "community_reply",
  heading: comment.parent_id
    ? "New reply"
    : "New comment",
  content: comment.parent_id
    ? `${name} replied to your comment.`
    : `${name} commented on your post.`,
  link: "/community",
  data: {
    post_id: comment.post_id,
    comment_id: comment.id,
  },
},
    });
    if (result === "sent") sent++;
    else skipped++;
  }
  return { sent, skipped };
}

async function communityLike(
  body: Extract<EventBody, { type: "community_like" }>
) {
  const admin = createAdminSupabaseClient();

  if (body.target_type === "post") {
    const postResult = await admin
      .from("posts")
      .select("id,user_id")
      .eq("id", body.record_id)
      .maybeSingle();

    if (postResult.error) throw postResult.error;

    const post = postResult.data;
    if (!post) return { sent: 0, skipped: 1 };

    let recipientUserId = post.user_id as string | null;

    if (!recipientUserId) {
      const ownerResult = await admin
        .from("anonymous_post_owners")
        .select("user_id")
        .eq("post_id", post.id)
        .maybeSingle();

      if (ownerResult.error) throw ownerResult.error;

      recipientUserId = ownerResult.data?.user_id ?? null;
    }

    if (!recipientUserId || recipientUserId === body.actor_user_id) {
      return { sent: 0, skipped: 1 };
    }
    const name = await actorName(admin, body.actor_user_id);

    const result = await sendIfAllowed({
      admin,
      userId: recipientUserId,
      type: "community_like",
      eventKey: `post:${post.id}:${body.actor_user_id ?? "unknown"}`,
      payload: {
        type: "community_like",
        heading: "New respect",
        content: `${name} respected your post.`,
        link: "/community",
        data: {
          post_id: post.id,
          target_type: "post",
        },
      },
    });

    return result === "sent"
      ? { sent: 1, skipped: 0 }
      : { sent: 0, skipped: 1 };
  }

  const commentResult = await admin
    .from("comments")
    .select("id,user_id,post_id,parent_id")
    .eq("id", body.record_id)
    .maybeSingle();

  if (commentResult.error) throw commentResult.error;

  const comment = commentResult.data;
  if (!comment) return { sent: 0, skipped: 1 };

  if (!comment.user_id || comment.user_id === body.actor_user_id) {
    return { sent: 0, skipped: 1 };
  }
  const name = await actorName(admin, body.actor_user_id);

  const result = await sendIfAllowed({
    admin,
    userId: comment.user_id,
    type: "community_like",
    eventKey: `comment:${comment.id}:${body.actor_user_id ?? "unknown"}`,
    payload: {
      type: "community_like",
      heading: "New respect",
      content: `${name} respected your comment.`,
      link: "/community",
      data: {
        post_id: comment.post_id,
        comment_id: comment.id,
        target_type: "comment",
      },
    },
  });

  return result === "sent"
    ? { sent: 1, skipped: 0 }
    : { sent: 0, skipped: 1 };
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
      eventKey: event.id,
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
    if (
  !body?.record_id ||
  ![
    "community_reply",
    "community_like",
    "co_parent_event_added",
  ].includes(body.type)
) if (
  body.type === "community_like" &&
  body.target_type !== "post" &&
  body.target_type !== "comment"
) {
  return NextResponse.json(
    { error: "Invalid community like target" },
    { status: 400 }
  );
}
    console.info("[notifications/events] Event received", {
      type: body.type,
      record: body.record_id.slice(0, 8),
    });
    let result;

if (body.type === "community_reply") {
  result = await communityReply(body);
} else if (body.type === "community_like") {
  result = await communityLike(body);
} else {
  result = await coParentEvent(body);
}
    console.info("[notifications/events] Event processed", { type: body.type, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[notifications/events]", error);
    return NextResponse.json({ error: "Event dispatch failed" }, { status: 500 });
  }
}
