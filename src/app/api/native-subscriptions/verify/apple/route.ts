import { NextResponse } from "next/server";

import { appleEntitlementInput, verifyAppleTransaction } from "@/lib/native-subscriptions/apple";
import { authenticateNativeSubscriptionRequest } from "@/lib/native-subscriptions/auth";
import { consumeSubscriptionVerificationAttempt } from "@/lib/native-subscriptions/rate-limit";
import { nativeSubscriptionErrorResponse } from "@/lib/native-subscriptions/route-response";
import { findSubscriptionEntitlement, getSubscriptionSummary, upsertSubscriptionEntitlement } from "@/lib/native-subscriptions/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
  try {
    if (!(await consumeSubscriptionVerificationAttempt(auth, "apple"))) {
      return NextResponse.json({ error: "Too many attempts. Please try again later.", code: "rate_limited" }, { status: 429 });
    }
    const body = (await request.json()) as { signedTransaction?: unknown };
    if (typeof body.signedTransaction !== "string") {
      return NextResponse.json({ error: "Apple purchase information is missing", code: "invalid_request" }, { status: 400 });
    }
    const verificationStartedAt = new Date().toISOString();
    const verified = await verifyAppleTransaction(body.signedTransaction);
    const originalId = verified.transaction.originalTransactionId;
    if (!originalId) throw new Error("Apple transaction is incomplete");
    const existing = await findSubscriptionEntitlement(auth.admin, "apple", originalId);
    const accountToken = verified.transaction.appAccountToken?.toLowerCase();
    if ((accountToken && accountToken !== auth.user.id.toLowerCase()) || (existing && existing.user_id !== auth.user.id)) {
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
      return NextResponse.json({ ok: true, summary: await getSubscriptionSummary(auth.admin, auth.user.id) });
    }
    await upsertSubscriptionEntitlement(
      auth.admin,
      appleEntitlementInput(auth.user.id, verified, null, undefined, verificationStartedAt),
    );
    return NextResponse.json({ ok: true, summary: await getSubscriptionSummary(auth.admin, auth.user.id) });
  } catch (error) {
    return nativeSubscriptionErrorResponse(error);
  }
}
