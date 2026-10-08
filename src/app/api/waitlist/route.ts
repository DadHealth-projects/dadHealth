import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/resend";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  const firstName = typeof values.firstName === "string" ? values.firstName.trim() : "";
  const email = typeof values.email === "string" ? values.email.trim().toLowerCase() : "";
  const website = typeof values.website === "string" ? values.website.trim() : "";

  if (website) return NextResponse.json({ ok: true });

  if (firstName.length > 100 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    await sendEmail({
      to: "hello@dadhealth.co.uk",
      subject: "Dad Health waitlist signup",
      html: `
        <h1>Dad Health waitlist signup</h1>
        <p><strong>First name:</strong> ${firstName ? escapeHtml(firstName) : "Not provided"}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to join the waitlist." }, { status: 502 });
  }
}
