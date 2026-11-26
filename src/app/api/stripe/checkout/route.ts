import { safeError } from '@/lib/safeError';
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import { getStripe } from "@/lib/stripe/server";
import {
  getStripePlanIdentifier,
  getTrialDays,
  isStripePriceId,
  isStripeProductId,
} from "@/lib/stripe/config";
import { getSiteUrl } from "@/lib/site-url";

class StripeCheckoutConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeCheckoutConfigError";
  }
}

async function resolveCheckoutPriceId(
  rawIdentifier: string,
  plan: "monthly" | "annual",
  stripe: ReturnType<typeof getStripe>
): Promise<string> {
  if (isStripePriceId(rawIdentifier)) return rawIdentifier;

  if (isStripeProductId(rawIdentifier)) {
    const product = await stripe.products.retrieve(rawIdentifier, { expand: ["default_price"] });
    const defaultPrice = product.default_price;
    if (typeof defaultPrice === "string" && defaultPrice.startsWith("price_")) {
      return defaultPrice;
    }
    if (
      defaultPrice &&
      typeof defaultPrice === "object" &&
      "id" in defaultPrice &&
      typeof defaultPrice.id === "string" &&
      defaultPrice.id.startsWith("price_")
    ) {
      return defaultPrice.id;
    }

    // Fallback for products that do not set default_price in Dashboard:
    // pick an active recurring price matching the requested plan cadence.
    const recurringInterval = plan === "monthly" ? "month" : "year";
    const prices = await stripe.prices.list({
      product: rawIdentifier,
      active: true,
      type: "recurring",
      limit: 100,
    });
    const matched = prices.data.find(
      (price) =>
        price.recurring?.interval === recurringInterval &&
        typeof price.id === "string" &&
        price.id.startsWith("price_")
    );
    if (matched?.id) return matched.id;

    throw new StripeCheckoutConfigError(
      `Stripe product ${rawIdentifier} has no usable ${recurringInterval} recurring price`
    );
  }

  throw new StripeCheckoutConfigError(`Unsupported Stripe plan identifier: ${rawIdentifier}`);
}

export async function POST(request: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Checkout unavailable" }, { status: 503 });
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: "Checkout unavailable" }, { status: 503 });
    }

    const body = (await request.json()) as { plan?: "monthly" | "annual" };
    const plan = body.plan === "monthly" ? "monthly" : "annual";
    const rawIdentifier = getStripePlanIdentifier(plan);

    if (!rawIdentifier) {
      return NextResponse.json(
        { error: "Stripe pricing is not configured for this plan." },
        { status: 503 }
      );
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const stripe = getStripe();
    
    // Use the request origin to ensure the cancel/success URLs match exactly
    // where the user is visiting from (preventing vercel.app URLs if on custom domain)
    const reqOrigin = request.headers.get("origin") || 
      (request.headers.get("referer") ? new URL(request.headers.get("referer")!).origin : null);
    const origin = reqOrigin || getSiteUrl();

    const priceId = await resolveCheckoutPriceId(rawIdentifier, plan, stripe);
    const trialDays = getTrialDays();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?checkout=canceled`,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
      subscription_data: {
        metadata: { supabase_user_id: user.id },
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      },
    });

    if (!session.url) {
      return NextResponse.json({ error: "Checkout session missing URL" }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[stripe/checkout]", safeError(e));
    if (e instanceof StripeCheckoutConfigError) {
      return NextResponse.json({ error: "Stripe plan is misconfigured. Contact support." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not start checkout" }, { status: 500 });
  }
}