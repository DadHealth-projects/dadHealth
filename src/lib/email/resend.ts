function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const RESEND_FROM = "Dad Health <noreply@send.dadhealth.co.uk>";

/**
 * Send a transactional email via the Resend REST API.
 * Uses fetch (no SDK dependency) — same approach as the OneSignal helper.
 * Requires RESEND_API_KEY. The sender uses the verified Resend subdomain.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<void> {
  const apiKey = requiredEnv("RESEND_API_KEY");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
}
