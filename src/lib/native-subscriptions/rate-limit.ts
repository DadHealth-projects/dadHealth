import { createHash } from "node:crypto";

import type { NativeSubscriptionAuth } from "./auth";
import type { NativeSubscriptionProvider } from "./types";

const LIMIT = 20;
const WINDOW_SECONDS = 15 * 60;

export async function consumeSubscriptionVerificationAttempt(
  auth: NativeSubscriptionAuth,
  provider: NativeSubscriptionProvider,
): Promise<boolean> {
  const bucketHash = createHash("sha256")
    .update(`native-subscription:${provider}:${auth.user.id}`, "utf8")
    .digest("hex");
  const { data, error } = await auth.admin.rpc("consume_subscription_verification_rate_limit", {
    p_bucket_hash: bucketHash,
    p_limit: LIMIT,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (error) throw error;
  return data === true;
}

export const SUBSCRIPTION_RATE_LIMIT_WINDOW_SECONDS = WINDOW_SECONDS;
