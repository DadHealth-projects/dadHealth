import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

const ATTEMPT_LIMIT = 5;
const WINDOW_SECONDS = 10 * 60;

type RateLimitRow = {
  allowed: boolean;
  retry_after_seconds: number;
};

export type PrivacyRequestRateLimit = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function trustedClientIp(request: Request) {
  if (process.env.NODE_ENV !== "production") return "127.0.0.1";
  if (process.env.VERCEL !== "1") throw new Error("Untrusted deployment proxy");

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  if (!ip || isIP(ip) === 0) throw new Error("Trusted client IP unavailable");
  return ip;
}

function bucketHash(ip: string) {
  const secret = process.env.PRIVACY_RATE_LIMIT_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Privacy request rate limiter is not configured");
  }

  return createHmac("sha256", secret)
    .update(`privacy-request-ip-v1\0${ip}`, "utf8")
    .digest("hex");
}

function isRateLimitRow(value: unknown): value is RateLimitRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RateLimitRow>;
  return typeof row.allowed === "boolean"
    && Number.isInteger(row.retry_after_seconds)
    && Number(row.retry_after_seconds) >= 0;
}

export async function consumePrivacyRequestRateLimit(
  request: Request,
): Promise<PrivacyRequestRateLimit> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("consume_privacy_request_rate_limit", {
    p_bucket_hash: bucketHash(trustedClientIp(request)),
    p_limit: ATTEMPT_LIMIT,
    p_window_seconds: WINDOW_SECONDS,
  });

  const row = Array.isArray(data) ? data[0] : null;
  if (error || !isRateLimitRow(row)) throw new Error("Privacy request rate-limit verification failed");

  return {
    allowed: row.allowed,
    retryAfterSeconds: row.retry_after_seconds,
  };
}
