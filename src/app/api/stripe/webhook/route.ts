import { safeError } from '@/lib/safeError';
import { stripePaidEvidence } from '@/lib/analytics/provider-evidence';
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { syncUserProfile } from "@/lib/stripe/sync-user-profile";
import { privacyOwnerRemoved, RemovedPrivacyOwnerError } from '@/lib/privacy/operations';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';

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
    console.error("[stripe/webhook] Signature verification failed", safeError(err));
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
        if (await privacyOwnerRemoved(createAdminSupabaseClient(), userId, 'stripe', subId)) break;

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
          trial_end: sub.trial_end ? new Date(sub.trial_end*1000).toISOString() : null,
          ...(sub.trial_start && sub.trial_end ? {trialFacts:{transactionId:`trial:${sub.id}:${sub.trial_start}`,startedAt:new Date(sub.trial_start*1000).toISOString(),endsAt:new Date(sub.trial_end*1000).toISOString()}} : {}),
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const eventSubscription = event.data.object as Stripe.Subscription;
        const userId = getUserIdFromSubscription(eventSubscription);
        if (!userId) break;

        const verificationStartedAt = new Date().toISOString();
        if (await privacyOwnerRemoved(createAdminSupabaseClient(), userId, 'stripe', eventSubscription.id)) break;
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
          trial_end: sub.trial_end ? new Date(sub.trial_end*1000).toISOString() : null,
          ...(sub.trial_start && sub.trial_end ? {trialFacts:{transactionId:`trial:${sub.id}:${sub.trial_start}`,startedAt:new Date(sub.trial_start*1000).toISOString(),endsAt:new Date(sub.trial_end*1000).toISOString()}} : {}),
        });
        break;
      }
      case "invoice.paid": {
        const invoice=event.data.object as Stripe.Invoice;
        const subscriptionId=typeof invoice.subscription==='string'?invoice.subscription:invoice.subscription?.id;
        if(!subscriptionId) break;
        const verificationStartedAt=new Date().toISOString();
        const sub=await getStripe().subscriptions.retrieve(subscriptionId);
        const userId=getUserIdFromSubscription(sub);
        if(!userId || await privacyOwnerRemoved(createAdminSupabaseClient(),userId,'stripe',sub.id)) break;
        const payment=stripePaidEvidence(invoice,sub.id);
        await syncUserProfile(userId,{
          stripe_customer_id:typeof sub.customer==='string'?sub.customer:sub.customer.id,
          stripe_subscription_id:sub.id,subscription_status:sub.status,
          current_period_end:new Date(sub.current_period_end*1000).toISOString(),
          auto_renews:!sub.cancel_at_period_end && sub.status!=='canceled',last_verified_at:verificationStartedAt,
          trial_end:sub.trial_end?new Date(sub.trial_end*1000).toISOString():null,
          verifiedPayment:payment,
        });
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    if (e instanceof RemovedPrivacyOwnerError) return NextResponse.json({ received: true });
    console.error("[stripe/webhook] Handler error", safeError(e));
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
