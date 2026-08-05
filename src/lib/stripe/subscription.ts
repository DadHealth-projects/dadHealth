/** Stripe subscription.status values that grant Pro access */
export function isProSubscriptionStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

/** Manual/admin Pro entitlement or an active Stripe-backed subscription. */
export function isProfilePro(profile: {
  is_pro?: boolean | string | number | null;
  subscription_status?: string | null;
} | null | undefined): boolean {
  return profile?.is_pro === true ||
    profile?.is_pro === "true" ||
    profile?.is_pro === 1 ||
    profile?.is_pro === "1" ||
    isProSubscriptionStatus(profile?.subscription_status);
}
