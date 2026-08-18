import { NextResponse } from "next/server";

import {
  BIOMETRIC_DEVICE_ATTEMPT_LIMIT,
  BIOMETRIC_IP_ATTEMPT_LIMIT,
  BIOMETRIC_RATE_LIMIT_WINDOW_SECONDS,
  BiometricConfigurationError,
  constantTimeDigestEqual,
  digestBiometricCredential,
  digestRateLimitBucket,
  getBiometricRequestIp,
  isValidBiometricCredential,
  isValidBiometricDeviceId,
} from "@/lib/auth/biometric-device";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" };

function json(body: Record<string, unknown>, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

async function consumeRateLimit(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  bucketHash: string,
  limit: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("consume_biometric_auth_rate_limit", {
    p_bucket_hash: bucketHash,
    p_limit: limit,
    p_window_seconds: BIOMETRIC_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (error) throw error;
  return data === true;
}

export async function POST(request: Request) {
  try {
    const admin = createAdminSupabaseClient();
    const ipBucket = digestRateLimitBucket("ip", getBiometricRequestIp(request));
    if (!(await consumeRateLimit(admin, ipBucket, BIOMETRIC_IP_ATTEMPT_LIMIT))) {
      return json(
        { code: "rate_limited" },
        429,
        { "Retry-After": String(BIOMETRIC_RATE_LIMIT_WINDOW_SECONDS) },
      );
    }

    const body = await request.json().catch(() => null) as {
      deviceId?: unknown;
      credential?: unknown;
    } | null;

    const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "invalid-device";
    const deviceBucket = digestRateLimitBucket("device", deviceId.slice(0, 128));
    if (!(await consumeRateLimit(admin, deviceBucket, BIOMETRIC_DEVICE_ATTEMPT_LIMIT))) {
      return json(
        { code: "rate_limited" },
        429,
        { "Retry-After": String(BIOMETRIC_RATE_LIMIT_WINDOW_SECONDS) },
      );
    }

    const validDeviceId = isValidBiometricDeviceId(body?.deviceId);
    const validCredential = isValidBiometricCredential(body?.credential);
    const suppliedCredential = validCredential ? body.credential : "0".repeat(64);
    const suppliedDigest = digestBiometricCredential(suppliedCredential);

    const deviceResult = validDeviceId
      ? await admin
          .from("biometric_device_credentials")
          .select("id,user_id,credential_digest")
          .eq("id", body.deviceId)
          .maybeSingle()
      : { data: null, error: null };

    if (deviceResult.error) throw deviceResult.error;

    const expectedDigest = deviceResult.data?.credential_digest ?? digestBiometricCredential("f".repeat(64));
    const matches = constantTimeDigestEqual(suppliedDigest, expectedDigest);

    if (!validDeviceId || !validCredential || !deviceResult.data || !matches) {
      return json({ code: "credential_invalid" }, 401);
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(deviceResult.data.user_id);
    const email = userData.user?.email;
    if (userError || !email) return json({ code: "credential_invalid" }, 401);

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = linkData.properties?.hashed_token;

    if (linkError || !tokenHash || linkData.user?.id !== deviceResult.data.user_id) {
      console.error("[auth/biometric/exchange] token generation failed", {
        userId: deviceResult.data.user_id,
        code: linkError?.code,
      });
      return json({ code: "exchange_unavailable" }, 503);
    }

    const { error: updateError } = await admin
      .from("biometric_device_credentials")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", deviceResult.data.id);
    if (updateError) {
      console.error("[auth/biometric/exchange] last-used update failed", {
        deviceId: deviceResult.data.id,
        code: updateError.code,
      });
    }

    return json({ tokenHash, type: "magiclink" }, 200);
  } catch (error) {
    if (!(error instanceof BiometricConfigurationError)) {
      console.error("[auth/biometric/exchange] request failed", error);
    }
    return json({ code: "exchange_unavailable" }, 503);
  }
}
