import { isUuid, ownedSubscription } from '@/lib/native-subscriptions/cancellation';
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
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { subscriptionId } = body as { subscriptionId?: unknown };
    if (subscriptionId !== undefined && !isUuid(subscriptionId)) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    const selected = typeof subscriptionId === 'string' ? await ownedSubscription(auth, subscriptionId) : null;
    if (subscriptionId !== undefined && (!selected || selected.provider !== 'apple')) {
      return NextResponse.json({ error: 'Subscription unavailable' }, { status: 404 });
    }
    const summary = selected ? null : await getSubscriptionSummary(auth.admin, auth.user.id);
    const provider = selected?.provider ?? summary?.primaryProvider;
    const productId = selected?.product_id ?? summary?.productId;
    if (!provider || (!selected && !summary?.isPro)) {
      return NextResponse.json({ error: 'No active subscription was found', code: 'not_subscribed' }, { status: 404 });
    }
    if (provider === "apple") {
      return NextResponse.json({ url: "https://apps.apple.com/account/subscriptions" });
    }
    if (provider === "google") {
      const params = new URLSearchParams({ package: DAD_HEALTH_ANDROID_PACKAGE });
      if (productId) params.set("sku", productId);
      return NextResponse.json({ url: `https://play.google.com/store/account/subscriptions?${params}` });
    }
    if (provider === "manual") {
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
