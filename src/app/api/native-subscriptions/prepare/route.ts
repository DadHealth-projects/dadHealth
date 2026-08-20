import { NextResponse } from "next/server";

import { authenticateNativeSubscriptionRequest } from "@/lib/native-subscriptions/auth";
import { requireAppleProductIds, requireGoogleProductConfig } from "@/lib/native-subscriptions/config";
import { googleAccountReference } from "@/lib/native-subscriptions/google";
import { nativeSubscriptionErrorResponse } from "@/lib/native-subscriptions/route-response";
import { getSubscriptionSummary, registerGoogleAccountLink } from "@/lib/native-subscriptions/store";
import type { NativeSubscriptionProvider, SubscriptionPlan } from "@/lib/native-subscriptions/types";

export const runtime = "nodejs";

interface PrepareBody {
  provider?: NativeSubscriptionProvider;
  plan?: SubscriptionPlan;
}

export async function POST(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as PrepareBody;
    if ((body.provider !== "apple" && body.provider !== "google") || (body.plan !== "monthly" && body.plan !== "annual")) {
      return NextResponse.json({ error: "Choose a valid subscription", code: "invalid_request" }, { status: 400 });
    }
    const summary = await getSubscriptionSummary(auth.admin, auth.user.id);
    if (!summary.canPurchase) {
      return NextResponse.json(
        { error: "Dad Health Pro is already active on this account", code: "already_subscribed", summary },
        { status: 409 },
      );
    }

    if (body.provider === "apple") {
      const products = requireAppleProductIds();
      return NextResponse.json({
        provider: "apple",
        productId: products[body.plan],
        appAccountToken: auth.user.id,
      });
    }

    const products = requireGoogleProductConfig();
    const accountReference = googleAccountReference(auth.user.id);
    await registerGoogleAccountLink(auth.admin, auth.user.id, accountReference);
    return NextResponse.json({
      provider: "google",
      productId: products.productId,
      basePlanId: body.plan === "monthly" ? products.monthlyBasePlanId : products.annualBasePlanId,
      trialOfferId: body.plan === "monthly" ? products.monthlyTrialOfferId : products.annualTrialOfferId,
      obfuscatedAccountId: accountReference,
    });
  } catch (error) {
    return nativeSubscriptionErrorResponse(error);
  }
}
