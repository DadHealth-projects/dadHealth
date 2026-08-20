import { NextResponse } from "next/server";

import { SubscriptionConfigurationError } from "./config";
import { SubscriptionOwnershipError } from "./store";

export function nativeSubscriptionErrorResponse(error: unknown) {
  if (error instanceof SubscriptionConfigurationError) {
    return NextResponse.json({ error: "Subscriptions are not available right now", code: "not_configured" }, { status: 503 });
  }
  if (error instanceof SubscriptionOwnershipError) {
    return NextResponse.json({ error: error.message, code: "already_linked" }, { status: 409 });
  }
  const code = error instanceof Error ? error.name : "unknown_error";
  console.error("[native-subscriptions] Request failed", { code });
  return NextResponse.json(
    { error: "We couldn't verify your subscription. Please try again.", code: "verification_failed" },
    { status: 422 },
  );
}
