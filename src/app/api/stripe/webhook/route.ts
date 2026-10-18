import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { syncUserProfile } from "@/lib/stripe/sync-user-profile";

export const runtime = "nodejs";

function getUserIdFromSubscription(sub: Stripe.Subscription): string | undefined {
  return sub.metadata?.supabase_user_id;
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.error("[stripe/webhook] Signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const userId =
          session.metadata?.supabase_user_id ?? session.client_reference_id ?? undefined;
        if (!userId) break;

        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

        if (!customerId || !subId) break;

        const verificationStartedAt = new Date().toISOString();
        const stripe = getStripe();
        const sub = await stripe.subscriptions.retrieve(subId);

        await syncUserProfile(userId, {
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          subscription_status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          auto_renews: !sub.cancel_at_period_end && sub.status !== "canceled",
          last_verified_at: verificationStartedAt,
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const eventSubscription = event.data.object as Stripe.Subscription;
        const userId = getUserIdFromSubscription(eventSubscription);
        if (!userId) break;

        const verificationStartedAt = new Date().toISOString();
        const sub = await getStripe().subscriptions.retrieve(eventSubscription.id);
        const cust = sub.customer;
        const customerId = typeof cust === "string" ? cust : cust.id;

        await syncUserProfile(userId, {
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          auto_renews: !sub.cancel_at_period_end && sub.status !== "canceled",
          last_verified_at: verificationStartedAt,
        });
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[stripe/webhook] Handler error", e);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
