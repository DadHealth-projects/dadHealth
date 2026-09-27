import { NextResponse } from "next/server";

import { getSubscriptionSummary } from "@/lib/native-subscriptions/store";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { createServerSupabaseClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

/** Web and native UI read the same server-authoritative Pro summary. */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ isPro: false, isSubscribed: false, status: null }, noStore);

  try {
    const summary = await getSubscriptionSummary(createAdminSupabaseClient(), user.id);
    return NextResponse.json({
      isPro: summary.isPro,
      isSubscribed: summary.isPro && summary.primaryProvider !== "manual",
      status: summary.status,
    }, noStore);
  } catch (error) {
    console.error("[stripe/subscription] Could not load canonical entitlement", error);
    return NextResponse.json({ error: "Subscription status unavailable" }, { ...noStore, status: 503 });
  }
}
