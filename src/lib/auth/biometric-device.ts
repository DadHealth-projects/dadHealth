import { createHmac, timingSafeEqual } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_PATTERN = /^[0-9a-f]{64}$/i;

export const BIOMETRIC_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const BIOMETRIC_DEVICE_ATTEMPT_LIMIT = 10;
export const BIOMETRIC_IP_ATTEMPT_LIMIT = 30;

export class BiometricConfigurationError extends Error {
  constructor() {
    super("Biometric credential service is not configured");
    this.name = "BiometricConfigurationError";
  }
}

function getPepper(): string {
  const pepper = process.env.BIOMETRIC_CREDENTIAL_PEPPER;
  if (!pepper || Buffer.byteLength(pepper, "utf8") < 32) {
    throw new BiometricConfigurationError();
  }
  return pepper;
}

function hmac(domain: string, value: string): string {
  return createHmac("sha256", getPepper())
    .update(`${domain}\0${value}`, "utf8")
    .digest("hex");
}

export function isValidBiometricCredential(value: unknown): value is string {
  return typeof value === "string" && CREDENTIAL_PATTERN.test(value);
}

export function isValidBiometricDeviceId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function digestBiometricCredential(credential: string): string {
  return hmac("dadhealth-biometric-credential-v1", credential);
}

export function digestRateLimitBucket(kind: "device" | "ip", value: string): string {
  return hmac(`dadhealth-biometric-rate-${kind}-v1`, value);
}

export function constantTimeDigestEqual(actualHex: string, expectedHex: string): boolean {
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (actual.length !== 32 || expected.length !== 32) {
    const dummy = Buffer.alloc(32);
    timingSafeEqual(dummy, dummy);
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function getBiometricRequestIp(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
