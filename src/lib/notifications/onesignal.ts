import type { NotificationPayload } from "@/lib/notifications/types";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export async function sendOneSignalToExternalUserId(args: {
  externalUserId: string;
  payload: NotificationPayload;
  idempotencyKey: string;
}): Promise<{ id: string }> {
  const appId = requiredEnv("ONESIGNAL_APP_ID");
  const apiKey = requiredEnv("ONESIGNAL_REST_API_KEY");
  const siteUrl = requiredEnv("NEXT_PUBLIC_SITE_URL").replace(/\/+$/, "");

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      target_channel: "push",
      include_aliases: { external_id: [args.externalUserId] },
      headings: { en: args.payload.heading },
      contents: { en: args.payload.content },
      web_url: `${siteUrl}${args.payload.link}`,
      idempotency_key: args.idempotencyKey,
      data: {
        type: args.payload.type,
        link: args.payload.link,
        ...args.payload.data,
      },
    }),
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`OneSignal error ${response.status}: ${text}`);
  }

  const body = JSON.parse(text || "{}") as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) {
    throw new Error("OneSignal accepted the request but did not create a notification");
  }

  console.info("[notifications/onesignal] Message accepted", {
    user: args.externalUserId.slice(0, 8),
    type: args.payload.type,
    providerMessage: body.id.slice(0, 8),
  });

  return { id: body.id };
}
