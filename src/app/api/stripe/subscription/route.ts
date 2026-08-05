import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import { getStripe } from "@/lib/stripe/server";
import { isProfilePro, isProSubscriptionStatus } from "@/lib/stripe/subscription";
import { syncUserProfile } from "@/lib/stripe/sync-user-profile";

/** Only treat a Stripe subscription as this user's Pro access if metadata matches or the profile row already references this sub (webhook-linked). */
function subscriptionGrantsProForUser(
  sub: Stripe.Subscription,
  userId: string,
  profileSubscriptionId: string | null | undefined
): boolean {
  if (!isProSubscriptionStatus(sub.status)) return false;
  const metaUser = sub.metadata?.supabase_user_id?.trim();
  if (metaUser && metaUser !== userId) return false;
  if (metaUser === userId) return true;
  // Legacy subs without metadata: trust only if this row was tied to this subscription id
  if (profileSubscriptionId && sub.id === profileSubscriptionId) return true;
  return false;
}

async function persistSubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  try {
    await syncUserProfile(userId, {
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
    });
  } catch (e) {
    console.error("[stripe/subscription] Could not persist profile (check SUPABASE_SERVICE_ROLE_KEY)", e);
  }
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ isPro: false, isSubscribed: false, status: null });
  }

  const { data: profile } = await supabase
    .from("user_profile")
    .select("is_pro, subscription_status, stripe_subscription_id, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const p = profile as {
    is_pro?: boolean | string | number | null;
    subscription_status?: string | null;
    stripe_subscription_id?: string | null;
    stripe_customer_id?: string | null;
  } | null;

  let status = p?.subscription_status ?? null;

  // `is_pro` is the explicit admin/manual entitlement and must not require a
  // matching Stripe subscription.
  if (p?.is_pro === true || p?.is_pro === "true" || p?.is_pro === 1 || p?.is_pro === "1") {
    return NextResponse.json({
      isPro: true,
      isSubscribed: isProSubscriptionStatus(status),
      status,
    });
  }

  // Without Stripe, do not trust DB subscription_status alone (local dev often has stale "active" rows).
  // Set TRUST_CACHED_SUBSCRIPTION_STATUS=true only if you intentionally test Pro UI without Stripe.
  if (!process.env.STRIPE_SECRET_KEY) {
    const trustDb = process.env.TRUST_CACHED_SUBSCRIPTION_STATUS === "true";
    const active = trustDb && isProfilePro(p);
    return NextResponse.json({
      isPro: active,
      isSubscribed: active,
      status,
    });
  }

  const stripe = getStripe();

  try {
    if (p?.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(p.stripe_subscription_id);
        status = sub.status;
        if (subscriptionGrantsProForUser(sub, user.id, p.stripe_subscription_id)) {
          await persistSubscription(user.id, sub);
          return NextResponse.json({ isPro: true, isSubscribed: true, status });
        }
      } catch {
        // Invalid or removed subscription id — try customer / email lookup
      }
    }

    const customerIdsToScan: string[] = [];
    if (p?.stripe_customer_id) {
      customerIdsToScan.push(p.stripe_customer_id);
    } else if (user.email) {
      const customers = await stripe.customers.list({ email: user.email, limit: 15 });
      const preferred = customers.data.filter((c) => c.metadata?.supabase_user_id === user.id);
      if (preferred.length > 0) {
        customerIdsToScan.push(...preferred.map((c) => c.id));
      } else {
        customerIdsToScan.push(...customers.data.map((c) => c.id));
      }
    }

    for (const cid of customerIdsToScan) {
      const subs = await stripe.subscriptions.list({
        customer: cid,
        status: "all",
        limit: 25,
      });
      const activeSub = subs.data.find((s) =>
        subscriptionGrantsProForUser(s, user.id, p?.stripe_subscription_id)
      );
      if (activeSub) {
        await persistSubscription(user.id, activeSub);
        return NextResponse.json({ isPro: true, isSubscribed: true, status: activeSub.status });
      }
    }
  } catch (e) {
    console.error("[stripe/subscription]", e);
  }

  // With Stripe configured, do not trust cached DB status alone (stale rows or wrong email matches).
  return NextResponse.json({
    isPro: false,
    isSubscribed: false,
    status,
  });
}
