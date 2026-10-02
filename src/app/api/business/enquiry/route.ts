import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/resend";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPLOYEE_OPTIONS = ["Under 25", "25–99", "100–249", "250+"] as const;
const MAX_LENGTHS = {
  name: 100,
  company: 150,
  email: 254,
  message: 4000,
} as const;

type EnquiryBody = {
  name?: unknown;
  company?: unknown;
  email?: unknown;
  size?: unknown;
  message?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function validationError(body: EnquiryBody) {
  const name = text(body.name);
  const company = text(body.company);
  const email = text(body.email).toLowerCase();
  const size = text(body.size);
  const message = text(body.message);

  if (!name || name.length > MAX_LENGTHS.name) return "Enter your name";
  if (!company || company.length > MAX_LENGTHS.company) return "Enter your company";
  if (!email || email.length > MAX_LENGTHS.email || !EMAIL_RE.test(email)) return "Enter a valid work email";
  if (!EMPLOYEE_OPTIONS.includes(size as (typeof EMPLOYEE_OPTIONS)[number])) return "Select an employee range";
  if (message.length > MAX_LENGTHS.message) return "Message is too long";

  return null;
}

function enquiryHtml(body: Required<EnquiryBody>) {
  const fields = [
    ["Your name", text(body.name)],
    ["Company", text(body.company)],
    ["Work email", text(body.email).toLowerCase()],
    ["Eligible employees", text(body.size)],
    ["Anything we should know?", text(body.message) || "Not provided"],
  ];

  const rows = fields
    .map(
      ([label, value]) => `
        <tr>
          <th style="padding: 8px 16px 8px 0; text-align: left; vertical-align: top;">${escapeHtml(label)}</th>
          <td style="padding: 8px 0; white-space: pre-wrap;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  return `<h1>Dad Health for Business enquiry</h1><table>${rows}</table>`;
}

export async function POST(request: NextRequest) {
  let body: EnquiryBody;

  try {
    body = (await request.json()) as EnquiryBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const error = validationError(body);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const name = text(body.name);
  const company = text(body.company);
  const email = text(body.email).toLowerCase();
  const size = text(body.size);
  const message = text(body.message);

  try {
    await sendEmail({
      to: "hello@dadhealth.co.uk",
      replyTo: email,
      subject: `Dad Health for Business enquiry - ${company.replace(/[\r\n]+/g, " ")}`,
      html: enquiryHtml({ name, company, email, size, message }),
    });
  } catch {
    return NextResponse.json({ error: "Unable to send enquiry" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
