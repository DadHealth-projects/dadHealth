import { NextResponse } from "next/server";

import { authenticateNativeSubscriptionRequest } from "@/lib/native-subscriptions/auth";
import { DAD_HEALTH_ANDROID_PACKAGE } from "@/lib/native-subscriptions/config";
import { nativeSubscriptionErrorResponse } from "@/lib/native-subscriptions/route-response";
import { getSubscriptionSummary } from "@/lib/native-subscriptions/store";
import { getSiteUrl } from "@/lib/site-url";
import { getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
  try {
    const summary = await getSubscriptionSummary(auth.admin, auth.user.id);
    if (!summary.isPro || !summary.primaryProvider) {
      return NextResponse.json({ error: "No active subscription was found", code: "not_subscribed" }, { status: 404 });
    }
    if (summary.primaryProvider === "apple") {
      return NextResponse.json({ url: "https://apps.apple.com/account/subscriptions" });
    }
    if (summary.primaryProvider === "google") {
      const params = new URLSearchParams({ package: DAD_HEALTH_ANDROID_PACKAGE });
      if (summary.productId) params.set("sku", summary.productId);
      return NextResponse.json({ url: `https://play.google.com/store/account/subscriptions?${params}` });
    }
    if (summary.primaryProvider === "manual") {
      return NextResponse.json(
        { error: "This Pro access is managed by Dad Health", code: "managed_by_dad_health" },
        { status: 400 },
      );
    }

    const { data: profile, error } = await auth.admin
      .from("user_profile")
      .select("stripe_customer_id")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: "No billing account was found", code: "billing_account_missing" }, { status: 404 });
    }
    const portal = await getStripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${getSiteUrl()}/pricing`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    return nativeSubscriptionErrorResponse(error);
  }
}
