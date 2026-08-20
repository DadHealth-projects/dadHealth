import { NextResponse } from "next/server";

import { authenticateNativeSubscriptionRequest } from "@/lib/native-subscriptions/auth";
import { acknowledgeGooglePurchase, googleAccountReference, googleEntitlementInput, verifyGooglePurchase } from "@/lib/native-subscriptions/google";
import { consumeSubscriptionVerificationAttempt } from "@/lib/native-subscriptions/rate-limit";
import { nativeSubscriptionErrorResponse } from "@/lib/native-subscriptions/route-response";
import { findSubscriptionEntitlement, getSubscriptionSummary, upsertSubscriptionEntitlement } from "@/lib/native-subscriptions/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
  try {
    if (!(await consumeSubscriptionVerificationAttempt(auth, "google"))) {
      return NextResponse.json({ error: "Too many attempts. Please try again later.", code: "rate_limited" }, { status: 429 });
    }
    const body = (await request.json()) as { purchaseToken?: unknown };
    if (typeof body.purchaseToken !== "string") {
      return NextResponse.json({ error: "Google Play purchase information is missing", code: "invalid_request" }, { status: 400 });
    }
    const purchase = await verifyGooglePurchase(body.purchaseToken);
    const expectedAccount = googleAccountReference(auth.user.id);
    const purchaseAccount = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    const existing = await findSubscriptionEntitlement(auth.admin, "google", body.purchaseToken);
    if (purchaseAccount !== expectedAccount || (existing && existing.user_id !== auth.user.id)) {
      return NextResponse.json(
        { error: "This subscription belongs to another Dad Health account", code: "already_linked" },
        { status: 409 },
      );
    }
    const entitlement = googleEntitlementInput(auth.user.id, body.purchaseToken, purchase);
    await upsertSubscriptionEntitlement(auth.admin, entitlement);
    if (purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
      await acknowledgeGooglePurchase(body.purchaseToken, entitlement.productId!);
    }
    return NextResponse.json({ ok: true, summary: await getSubscriptionSummary(auth.admin, auth.user.id) });
  } catch (error) {
    return nativeSubscriptionErrorResponse(error);
  }
}
