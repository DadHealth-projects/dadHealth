import { NextResponse } from "next/server";

import { authenticateNativeSubscriptionRequest } from "@/lib/native-subscriptions/auth";
import { getCurrentWeekFreezeState, getSubscriptionSummary } from "@/lib/native-subscriptions/store";
import { nativeSubscriptionErrorResponse } from "@/lib/native-subscriptions/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  try {
    const summary = await getSubscriptionSummary(auth.admin, auth.user.id);
    const freezeState = summary.isPro
      ? await getCurrentWeekFreezeState(auth.admin, auth.user.id)
      : { freezeUsedThisWeek: false, freezesRemaining: 0 };
    return NextResponse.json({ ...summary, ...freezeState }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return nativeSubscriptionErrorResponse(error);
  }
}
