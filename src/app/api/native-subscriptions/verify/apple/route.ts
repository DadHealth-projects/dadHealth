import { NextResponse } from "next/server";

import { appleEntitlementInput, verifyAppleTransaction } from "@/lib/native-subscriptions/apple";
import { authenticateNativeSubscriptionRequest } from "@/lib/native-subscriptions/auth";
import { consumeSubscriptionVerificationAttempt } from "@/lib/native-subscriptions/rate-limit";
import { nativeSubscriptionErrorResponse } from "@/lib/native-subscriptions/route-response";
import { findSubscriptionEntitlement, getSubscriptionSummary, upsertSubscriptionEntitlement } from "@/lib/native-subscriptions/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const suppliedId = request.headers?.get('X-IAP-Debug-ID');
  const operationId = suppliedId && /^iap-[a-z0-9]{1,16}-[0-9]{1,9}$/.test(suppliedId)
    ? suppliedId : `server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const log = (stage: string, fields: Record<string, unknown> = {}) => {
    if (process.env.NODE_ENV === 'development' || process.env.IAP_DEBUG === 'true') {
      console.info(`[DadHealthIAP][server] ${stage}`, { operationId, ...fields });
    }
  };
  let stage = 'authentication';
  log('verification request received');
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
  log('authenticated');
  try {
    if (!(await consumeSubscriptionVerificationAttempt(auth, "apple"))) {
      return NextResponse.json({ error: "Too many attempts. Please try again later.", code: "rate_limited" }, { status: 429 });
    }
    const body = (await request.json()) as { signedTransaction?: unknown };
    if (typeof body.signedTransaction !== "string") {
      return NextResponse.json({ error: "Apple purchase information is missing", code: "invalid_request" }, { status: 400 });
    }
    const verificationStartedAt = new Date().toISOString();
    stage = 'apple_verification';
    const verified = await verifyAppleTransaction(body.signedTransaction);
    log('Apple transaction verified', { productId: verified.transaction.productId, environment: verified.environment });
    const originalId = verified.transaction.originalTransactionId;
    if (!originalId) throw new Error("Apple transaction is incomplete");
    stage = 'ownership_lookup';
    const existing = await findSubscriptionEntitlement(auth.admin, "apple", originalId);
    const accountToken = verified.transaction.appAccountToken?.toLowerCase();
    const tokenMismatch = Boolean(accountToken) && accountToken !== auth.user.id.toLowerCase();
    const existingOwnerMismatch = Boolean(existing) && existing!.user_id !== auth.user.id;
    log('ownership', {
      productId: verified.transaction.productId,
      environment: verified.environment,
      hasAppAccountToken: Boolean(accountToken),
      tokenMatchesUser: accountToken ? !tokenMismatch : null,
      existingEntitlementFound: Boolean(existing),
      existingOwnerMatchesUser: existing ? !existingOwnerMismatch : null,
      tokenMismatch,
      existingOwnerMismatch,
    });
    if (tokenMismatch || existingOwnerMismatch) {
      log('rejected', {
        reason: tokenMismatch ? 'app_account_token_mismatch' : 'existing_entitlement_owner_mismatch',
        productId: verified.transaction.productId,
      });
      return NextResponse.json(
        { error: "This subscription belongs to another Dad Health account", code: "already_linked" },
        { status: 409 },
      );
    }
    const existingGraceEnd = existing?.status === "grace_period" && existing.current_period_end
      ? Date.parse(existing.current_period_end)
      : Number.NaN;
    const transactionExpired = typeof verified.transaction.expiresDate === "number"
      && verified.transaction.expiresDate <= Date.now();
    // Transaction verification does not include renewal/grace data. Keep the
    // still-valid server-verified grace snapshot until Apple sends fresher
    // renewal information; never replace it with an incomplete expired snapshot.
    if (
      transactionExpired
      && !verified.transaction.revocationDate
      && Number.isFinite(existingGraceEnd)
      && existingGraceEnd > Date.now()
    ) {
      stage = 'membership_read';
      const summary = await getSubscriptionSummary(auth.admin, auth.user.id);
      log('membership returned', { isPro: summary.isPro, status: summary.status, preservedGrace: true });
      return NextResponse.json({ ok: true, summary });
    }
    stage = 'entitlement_upsert';
    log('entitlement upsert attempted');
    await upsertSubscriptionEntitlement(
      auth.admin,
      appleEntitlementInput(auth.user.id, verified, null, undefined, verificationStartedAt),
    );
    log('entitlement upsert completed');
    stage = 'membership_read';
    const summary = await getSubscriptionSummary(auth.admin, auth.user.id);
    log('membership returned', { isPro: summary.isPro, status: summary.status });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    log('verification failed', { stage, reason: error instanceof Error && error.name === 'SubscriptionOwnershipError'
      ? 'database_ownership_constraint_failure' : stage === 'apple_verification' ? 'apple_verification_failure' : 'other_backend_failure' });
    return nativeSubscriptionErrorResponse(error);
  }
}
