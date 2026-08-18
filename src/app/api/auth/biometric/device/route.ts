import { NextResponse } from "next/server";

import {
  BiometricConfigurationError,
  digestBiometricCredential,
  isValidBiometricCredential,
  isValidBiometricDeviceId,
} from "@/lib/auth/biometric-device";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

export async function POST(request: Request) {
  try {
    const token = bearerToken(request);
    if (!token) return json({ code: "auth_required" }, 401);

    const admin = createAdminSupabaseClient();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ code: "auth_required" }, 401);

    const body = await request.json().catch(() => null) as { credential?: unknown } | null;
    if (!isValidBiometricCredential(body?.credential)) {
      return json({ code: "invalid_credential" }, 400);
    }

    const { data, error } = await admin
      .from("biometric_device_credentials")
      .insert({
        user_id: authData.user.id,
        credential_digest: digestBiometricCredential(body.credential),
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      console.error("[auth/biometric/device] enrollment failed", {
        userId: authData.user.id,
        code: error?.code,
      });
      return json({ code: "enrollment_unavailable" }, 503);
    }

    return json({ deviceId: data.id }, 201);
  } catch (error) {
    if (!(error instanceof BiometricConfigurationError)) {
      console.error("[auth/biometric/device] enrollment failed", error);
    }
    return json({ code: "enrollment_unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const token = bearerToken(request);
    if (!token) return json({ code: "auth_required" }, 401);

    const admin = createAdminSupabaseClient();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ code: "auth_required" }, 401);

    const body = await request.json().catch(() => null) as { deviceId?: unknown } | null;
    if (!isValidBiometricDeviceId(body?.deviceId)) {
      return json({ code: "invalid_device" }, 400);
    }

    const { error } = await admin
      .from("biometric_device_credentials")
      .delete()
      .eq("id", body.deviceId)
      .eq("user_id", authData.user.id);

    if (error) {
      console.error("[auth/biometric/device] revocation failed", {
        userId: authData.user.id,
        code: error.code,
      });
      return json({ code: "revocation_unavailable" }, 503);
    }

    return json({ ok: true }, 200);
  } catch (error) {
    console.error("[auth/biometric/device] revocation failed", error);
    return json({ code: "revocation_unavailable" }, 503);
  }
}
