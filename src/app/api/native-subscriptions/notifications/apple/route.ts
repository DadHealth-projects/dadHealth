import { appleCancellationEvidence } from '@/lib/native-subscriptions/cancellation';
import { NextResponse } from "next/server";

import { appleEntitlementInput, verifyAppleNotification } from "@/lib/native-subscriptions/apple";
import { claimProviderEvent, completeProviderEvent, failProviderEvent } from "@/lib/native-subscriptions/provider-events";
import { findSubscriptionEntitlement, upsertSubscriptionEntitlement } from "@/lib/native-subscriptions/store";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { privacyOwnerRemoved, RemovedPrivacyOwnerError } from '@/lib/privacy/operations';
import { recordRetentionOfferRedemption, retentionOfferEvidence } from '@/lib/native-subscriptions/retention-offer';

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = createAdminSupabaseClient();
  let claimId: string | null = null;
  try {
    const body = (await request.json()) as { signedPayload?: unknown };
    if (typeof body.signedPayload !== "string") {
      return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
    }
    const verified = await verifyAppleNotification(body.signedPayload);
    const eventId = verified.notification.notificationUUID;
    if (!eventId) return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
    claimId = await claimProviderEvent(
      admin,
      "apple",
      eventId,
      String(verified.notification.notificationType ?? "unknown"),
      verified.environment,
    );
    if (!claimId) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (!verified.transaction?.originalTransactionId) {
      await completeProviderEvent(admin, claimId);
      return NextResponse.json({ ok: true });
    }
    const existing = await findSubscriptionEntitlement(
      admin,
      "apple",
      verified.transaction.originalTransactionId,
    );
    const userId = verified.transaction.appAccountToken ?? existing?.user_id;
    if (await privacyOwnerRemoved(admin, userId ?? null, 'apple', verified.transaction.originalTransactionId)) {
      await completeProviderEvent(admin, claimId);
      return NextResponse.json({ ok: true });
    }
    if (!userId || (existing && existing.user_id !== userId)) throw new Error("Apple subscription owner not found");
    const signedAt = (verified.notification as typeof verified.notification & { signedDate?: number }).signedDate;
    if (typeof signedAt !== 'number' || !Number.isFinite(signedAt) || signedAt <= 0) throw new Error('Apple signing date missing');
    const providerUpdatedAt = new Date(signedAt).toISOString();
    await upsertSubscriptionEntitlement(
      admin,
      { ...appleEntitlementInput(
        userId,
        { transaction: verified.transaction, environment: verified.environment },
        verified.renewal,
        verified.notification.data?.status,
        providerUpdatedAt,
      ), cancellationEvidence: appleCancellationEvidence(verified),
      ...(retentionOfferEvidence(verified.transaction) ? { retentionOffer: retentionOfferEvidence(verified.transaction)! } : {}) },
    );
    // Client audit A3: an accepted retention offer is recorded before the event is acknowledged,
    // so a failed save returns 500 and Apple retries it. Idempotent on Apple's transaction id.
    await recordRetentionOfferRedemption(admin, userId,
      { transaction: verified.transaction, environment: verified.environment }, 'store_notification');
    await completeProviderEvent(admin, claimId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RemovedPrivacyOwnerError && claimId) {
      await completeProviderEvent(admin, claimId);
      return NextResponse.json({ ok: true });
    }
    if (claimId) await failProviderEvent(admin, claimId, error instanceof Error ? error.name : "processing_failed");
    console.error("[native-subscriptions/apple-notification] Processing failed", {
      code: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "Notification processing failed" }, { status: 500 });
  }
}
