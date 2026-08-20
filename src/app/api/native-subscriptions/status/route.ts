import { NextResponse } from "next/server";

import { authenticateNativeSubscriptionRequest } from "@/lib/native-subscriptions/auth";
import { getSubscriptionSummary } from "@/lib/native-subscriptions/store";
import { nativeSubscriptionErrorResponse } from "@/lib/native-subscriptions/route-response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: "Sign in required", code: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getSubscriptionSummary(auth.admin, auth.user.id));
  } catch (error) {
    return nativeSubscriptionErrorResponse(error);
  }
}
