import { appleCancellationEvidence } from '@/lib/native-subscriptions/cancellation';
import { NextResponse } from "next/server";

import { appleEntitlementInput, verifyAppleNotification } from "@/lib/native-subscriptions/apple";
import { claimProviderEvent, completeProviderEvent, failProviderEvent } from "@/lib/native-subscriptions/provider-events";
import { findSubscriptionEntitlement, upsertSubscriptionEntitlement } from "@/lib/native-subscriptions/store";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const operationId = `notification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const log = (stage: string, fields: Record<string, unknown> = {}) => {
    if (process.env.NODE_ENV === 'development' || process.env.IAP_DEBUG === 'true') {
      console.info(`[DadHealthIAP][server] notification ${stage}`, { operationId, ...fields });
    }
  };
  let stage = 'verification';
  const admin = createAdminSupabaseClient();
  let claimId: string | null = null;
  try {
    const body = (await request.json()) as { signedPayload?: unknown };
    if (typeof body.signedPayload !== "string") {
      return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
    }
    const verified = await verifyAppleNotification(body.signedPayload);
    log('received', {
      type: verified.notification.notificationType,
      subtype: verified.notification.subtype,
      environment: verified.environment,
      hasAppAccountToken: Boolean(verified.transaction?.appAccountToken),
    });
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
      log('duplicate skipped');
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (!verified.transaction?.originalTransactionId) {
      await completeProviderEvent(admin, claimId);
      return NextResponse.json({ ok: true });
    }

    stage = 'ownership_lookup';
    const existing = await findSubscriptionEntitlement(
      admin,
      "apple",
      verified.transaction.originalTransactionId,
    );
    const userId = verified.transaction.appAccountToken ?? existing?.user_id;
    log('ownership', { hasResolvedOwner: Boolean(userId), existingEntitlementFound: Boolean(existing),
      existingOwnerMatches: existing ? existing.user_id === userId : null });
    if (!userId || (existing && existing.user_id !== userId)) throw new Error("Apple subscription owner not found");
    log('transaction matched', { existingEntitlementFound: Boolean(existing) });
    const signedAt = (verified.notification as typeof verified.notification & { signedDate?: number }).signedDate;
    if (typeof signedAt !== 'number' || !Number.isFinite(signedAt) || signedAt <= 0) throw new Error('Apple signing date missing');
    const providerUpdatedAt = new Date(signedAt).toISOString();
    stage = 'entitlement_upsert';
    log('entitlement upsert attempted');
    await upsertSubscriptionEntitlement(
      admin,
      { ...appleEntitlementInput(
        userId,
        { transaction: verified.transaction, environment: verified.environment },
        verified.renewal,
        verified.notification.data?.status,
        providerUpdatedAt,
      ), cancellationEvidence: appleCancellationEvidence(verified) },
    );
    log('entitlement upsert completed');
    await completeProviderEvent(admin, claimId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log('failed', { stage, ownershipConstraint: error instanceof Error && error.name === 'SubscriptionOwnershipError' });
    if (claimId) await failProviderEvent(admin, claimId, error instanceof Error ? error.name : "processing_failed");
    console.error("[native-subscriptions/apple-notification] Processing failed", {
      code: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "Notification processing failed" }, { status: 500 });
  }
}
