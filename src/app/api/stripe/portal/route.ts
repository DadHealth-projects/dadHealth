import { safeError } from '@/lib/safeError';
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import { getStripe } from "@/lib/stripe/server";
import { getSiteUrl } from "@/lib/site-url";

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("user_profile")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const customerId = (profile as { stripe_customer_id?: string } | null)?.stripe_customer_id;
    if (!customerId) {
      return NextResponse.json(
        { error: "No billing account found. Subscribe from the pricing page first." },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    
    // Use the request origin to ensure the return URL matches exactly
    // where the user is visiting from (preventing vercel.app URLs if on custom domain)
    const reqOrigin = request.headers.get("origin") || 
      (request.headers.get("referer") ? new URL(request.headers.get("referer")!).origin : null);
    const origin = reqOrigin || getSiteUrl();

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/pricing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[stripe/portal]", safeError(e));
    return NextResponse.json({ error: "Could not open billing portal" }, { status: 500 });
  }
}