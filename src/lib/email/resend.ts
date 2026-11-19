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
  attachments?: Array<{ filename: string; content: string }>;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<{ id: string }> {
  const apiKey = requiredEnv("RESEND_API_KEY");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: args.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(args.idempotencyKey ? { 'Idempotency-Key': args.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      ...(args.attachments ? { attachments: args.attachments } : {}),
    }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Resend request failed (${res.status})`);
  }
  const result = JSON.parse(text);
  if (typeof result?.id !== 'string') throw new Error('Resend confirmation unavailable');
  return { id: result.id };
}
