/** Stripe subscription.status values that grant Pro access */
export function isProSubscriptionStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}
