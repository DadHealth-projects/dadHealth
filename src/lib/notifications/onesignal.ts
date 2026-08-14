import type { NotificationPayload } from "@/lib/notifications/types";

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export async function sendOneSignalToExternalUserId(args: {
  externalUserId: string;
  payload: NotificationPayload;
}): Promise<void> {
  const appId = process.env.ONESIGNAL_APP_ID?.trim() || process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID?.trim();
  if (!appId) throw new Error("Missing ONESIGNAL_APP_ID (or NEXT_PUBLIC_ONESIGNAL_APP_ID)");
  const apiKey = requiredEnv("ONESIGNAL_REST_API_KEY");
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:8080").replace(/\/+$/, "");

  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_external_user_ids: [args.externalUserId],
      headings: { en: args.payload.heading },
      contents: { en: args.payload.content },
      url: `${siteUrl}${args.payload.link}`,
      data: {
        type: args.payload.type,
        link: args.payload.link,
        ...args.payload.data,
      },
    }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`OneSignal error ${res.status}: ${text}`);
  }

  try {
    const json = JSON.parse(text) as { id?: string; recipients?: number };
    if (typeof json.recipients === "number" && json.recipients === 0) {
      console.warn("[OneSignal] API accepted but recipients=0 — no subscribed device for this external_user_id", {
        externalUserId: args.externalUserId,
        notificationId: json.id,
      });
    }
  } catch {
    // non-JSON body; ignore
  }
}

