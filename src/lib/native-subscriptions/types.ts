export type SubscriptionProvider = "stripe" | "apple" | "google";
export type NativeSubscriptionProvider = "apple" | "google";
export type SubscriptionPlan = "monthly" | "annual";
export type SubscriptionEnvironment = "production" | "sandbox" | "test" | "legacy";

export interface SubscriptionEntitlementRow {
  id: string;
  user_id: string;
  provider: SubscriptionProvider;
  provider_subscription_id: string;
  provider_account_id: string | null;
  latest_transaction_id: string | null;
  product_id: string | null;
  plan: SubscriptionPlan | null;
  status: string;
  current_period_end: string | null;
  trial_end: string | null;
  auto_renews: boolean | null;
  environment: SubscriptionEnvironment;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionEntitlementInput {
  userId: string;
  provider: SubscriptionProvider;
  providerSubscriptionId: string;
  providerAccountId?: string | null;
  latestTransactionId?: string | null;
  productId?: string | null;
  plan?: SubscriptionPlan | null;
  status: string;
  currentPeriodEnd?: string | null;
  trialEnd?: string | null;
  autoRenews?: boolean | null;
  environment: SubscriptionEnvironment;
  lastVerifiedAt?: string;
}

export const ACCESS_GRANTING_STATUSES = new Set(["active", "trialing", "grace_period"]);

export function entitlementGrantsAccess(
  entitlement: Pick<SubscriptionEntitlementRow, "status" | "current_period_end">,
  now = Date.now(),
): boolean {
  if (!ACCESS_GRANTING_STATUSES.has(entitlement.status)) return false;
  if (!entitlement.current_period_end) return true;
  const periodEnd = Date.parse(entitlement.current_period_end);
  return Number.isFinite(periodEnd) && periodEnd > now;
}

export function unixMillisecondsToIso(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}
