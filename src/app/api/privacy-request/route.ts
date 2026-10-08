
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/resend";
import { consumePrivacyRequestRateLimit } from "@/lib/privacy-request-rate-limit";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUEST_TYPES = [
  "access",
  "correction",
  "deletion",
  "other",
] as const;

const MAX_BODY_BYTES = 8_192;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

type RequestType = (typeof REQUEST_TYPES)[number];

type PrivacyRequestBody = {
  email?: unknown;
  requestType?: unknown;
  details?: unknown;
  website?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function json(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (!origin) return true;

  return (
    origin === request.nextUrl.origin ||
    origin === "https://www.dadhealth.co.uk" ||
    origin === "https://dadhealth.co.uk"
  );
}

function privacyRequestHtml(
  email: string,
  requestType: RequestType,
  details: string
) {
  return `
    <h1>Dad Health privacy request</h1>
    <table>
      <tr>
        <th style="padding:8px 16px 8px 0;text-align:left;vertical-align:top">
          Email address
        </th>
        <td style="padding:8px 0">${escapeHtml(email)}</td>
      </tr>
      <tr>
        <th style="padding:8px 16px 8px 0;text-align:left;vertical-align:top">
          Request type
        </th>
        <td style="padding:8px 0">${escapeHtml(requestType)}</td>
      </tr>
      <tr>
        <th style="padding:8px 16px 8px 0;text-align:left;vertical-align:top">
          Details
        </th>
        <td style="padding:8px 0;white-space:pre-wrap">
          ${escapeHtml(details || "Not provided")}
        </td>
      </tr>
    </table>
  `;
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) {
    return json({ error: "Invalid request" }, 403);
  }

  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return json({ error: "Invalid request" }, 415);
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? 0
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BODY_BYTES
  ) {
    return json({ error: "Request is too large" }, 413);
  }

  let body: PrivacyRequestBody;

  try {
    const rawBody = await request.text();

    if (
      Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES
    ) {
      return json(
        { error: "Request is too large" },
        413
      );
    }

    body = JSON.parse(rawBody) as PrivacyRequestBody;
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json({ error: "Invalid request" }, 400);
  }

  const email = text(body.email).toLowerCase();
  const requestType = text(body.requestType);
  const details = text(body.details);
  const website = text(body.website);

  if (website) {
    return json({ ok: true });
  }

  if (
    !email ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email)
  ) {
    return json(
      { error: "Enter a valid email address" },
      400
    );
  }

  if (
    !REQUEST_TYPES.includes(
      requestType as RequestType
    )
  ) {
    return json(
      { error: "Select a valid request type" },
      400
    );
  }

  if (details.length > 2_000) {
    return json(
      { error: "Details are too long" },
      400
    );
  }

  let rateLimit;

  try {
    rateLimit = await consumePrivacyRequestRateLimit(request);
  } catch {
    return json(
      { error: "Service temporarily unavailable" },
      503,
    );
  }

  if (!rateLimit.allowed) {
    return json(
      { error: "Too many requests. Please try again later." },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  try {
    await sendEmail({
      to: "hello@dadhealth.co.uk",
      replyTo: email,
      subject: `Dad Health privacy request - ${requestType}`,
      html: privacyRequestHtml(
        email,
        requestType as RequestType,
        details
      ),
    });
  } catch {
    return json(
      { error: "Unable to send privacy request" },
      502
    );
  }

  return json({ ok: true });
}
