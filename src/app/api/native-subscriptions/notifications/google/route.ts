import { NextResponse } from "next/server";

import { DAD_HEALTH_ANDROID_PACKAGE } from "@/lib/native-subscriptions/config";
import { acknowledgeGooglePurchase, googleEntitlementInput, verifyGooglePurchase, verifyGoogleRtdnIdentity } from "@/lib/native-subscriptions/google";
import { claimProviderEvent, completeProviderEvent, failProviderEvent } from "@/lib/native-subscriptions/provider-events";
import { findGoogleAccountOwner, findSubscriptionEntitlement, upsertSubscriptionEntitlement } from "@/lib/native-subscriptions/store";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

interface GoogleRtdnEnvelope {
  message?: { data?: string; messageId?: string };
}

interface GoogleRtdnData {
  packageName?: string;
  subscriptionNotification?: {
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
  testNotification?: Record<string, never>;
}

export async function POST(request: Request) {
  const admin = createAdminSupabaseClient();
  let claimId: string | null = null;
  try {
    await verifyGoogleRtdnIdentity(request.headers.get("authorization"));
    const envelope = (await request.json()) as GoogleRtdnEnvelope;
    const messageId = envelope.message?.messageId;
    const encoded = envelope.message?.data;
    if (!messageId || !encoded) return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
    const data = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as GoogleRtdnData;
    if (data.packageName !== DAD_HEALTH_ANDROID_PACKAGE) {
      return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
    }
    claimId = await claimProviderEvent(
      admin,
      "google",
      messageId,
      data.testNotification ? "test" : `subscription_${data.subscriptionNotification?.notificationType ?? "unknown"}`,
      "production",
    );
    if (!claimId) return NextResponse.json({ ok: true, duplicate: true });
    const purchaseToken = data.subscriptionNotification?.purchaseToken;
    if (!purchaseToken) {
      await completeProviderEvent(admin, claimId);
      return NextResponse.json({ ok: true });
    }

    const purchase = await verifyGooglePurchase(purchaseToken);
    const accountReference = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    const existing = await findSubscriptionEntitlement(admin, "google", purchaseToken);
    const userId = accountReference ? await findGoogleAccountOwner(admin, accountReference) : existing?.user_id;
    if (!userId || (existing && existing.user_id !== userId)) throw new Error("Google subscription owner not found");
    const entitlement = googleEntitlementInput(userId, purchaseToken, purchase);
    await upsertSubscriptionEntitlement(admin, entitlement);
    if (purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
      await acknowledgeGooglePurchase(purchaseToken, entitlement.productId!);
    }
    await completeProviderEvent(admin, claimId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (claimId) await failProviderEvent(admin, claimId, error instanceof Error ? error.name : "processing_failed");
    console.error("[native-subscriptions/google-notification] Processing failed", {
      code: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "Notification processing failed" }, { status: 500 });
  }
}
