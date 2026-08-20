import { createAdminSupabaseClient } from "@/utils/supabase/admin";

import { entitlementGrantsAccess, type SubscriptionEntitlementInput, type SubscriptionEntitlementRow, type SubscriptionProvider } from "./types";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export class SubscriptionOwnershipError extends Error {
  constructor() {
    super("This subscription is already linked to another Dad Health account");
    this.name = "SubscriptionOwnershipError";
  }
}

export async function upsertSubscriptionEntitlement(
  admin: AdminClient,
  input: SubscriptionEntitlementInput,
): Promise<string> {
  const { data, error } = await admin.rpc("upsert_subscription_entitlement", {
    p_user_id: input.userId,
    p_provider: input.provider,
    p_provider_subscription_id: input.providerSubscriptionId,
    p_provider_account_id: input.providerAccountId ?? null,
    p_latest_transaction_id: input.latestTransactionId ?? null,
    p_product_id: input.productId ?? null,
    p_plan: input.plan ?? null,
    p_status: input.status,
    p_current_period_end: input.currentPeriodEnd ?? null,
    p_trial_end: input.trialEnd ?? null,
    p_auto_renews: input.autoRenews ?? null,
    p_environment: input.environment,
    p_last_verified_at: input.lastVerifiedAt ?? new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") throw new SubscriptionOwnershipError();
    throw error;
  }
  if (typeof data !== "string") throw new Error("Subscription entitlement was not saved");
  return data;
}

export async function registerGoogleAccountLink(
  admin: AdminClient,
  userId: string,
  accountReference: string,
): Promise<void> {
  const { error } = await admin.rpc("register_subscription_account_link", {
    p_user_id: userId,
    p_provider: "google",
    p_account_reference: accountReference,
  });
  if (error) {
    if (error.code === "23505") throw new SubscriptionOwnershipError();
    throw error;
  }
}

export async function findSubscriptionEntitlement(
  admin: AdminClient,
  provider: SubscriptionProvider,
  providerSubscriptionId: string,
): Promise<SubscriptionEntitlementRow | null> {
  const { data, error } = await admin
    .from("subscription_entitlements")
    .select("*")
    .eq("provider", provider)
    .eq("provider_subscription_id", providerSubscriptionId)
    .maybeSingle();
  if (error) throw error;
  return (data as SubscriptionEntitlementRow | null) ?? null;
}

export async function findGoogleAccountOwner(
  admin: AdminClient,
  accountReference: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("subscription_account_links")
    .select("user_id")
    .eq("provider", "google")
    .eq("account_reference", accountReference)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.user_id === "string" ? data.user_id : null;
}

export interface SubscriptionSummary {
  isPro: boolean;
  status: string | null;
  primaryProvider: SubscriptionProvider | "manual" | null;
  activeProviders: SubscriptionProvider[];
  plan: "monthly" | "annual" | null;
  productId: string | null;
  currentPeriodEnd: string | null;
  canPurchase: boolean;
}

function databaseBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export async function getSubscriptionSummary(
  admin: AdminClient,
  userId: string,
): Promise<SubscriptionSummary> {
  const [{ data: profile, error: profileError }, { data: rows, error: entitlementsError }] =
    await Promise.all([
      admin
        .from("user_profile")
        .select("is_pro, subscription_status, stripe_customer_id, stripe_subscription_id")
        .eq("user_id", userId)
        .maybeSingle(),
      admin.from("subscription_entitlements").select("*").eq("user_id", userId),
    ]);

  if (profileError) throw profileError;
  if (entitlementsError) throw entitlementsError;

  const entitlements = (rows ?? []) as SubscriptionEntitlementRow[];
  const active = entitlements
    .filter((item) => entitlementGrantsAccess(item))
    .sort((left, right) => {
      const leftEnd = left.current_period_end ? Date.parse(left.current_period_end) : Number.MAX_SAFE_INTEGER;
      const rightEnd = right.current_period_end ? Date.parse(right.current_period_end) : Number.MAX_SAFE_INTEGER;
      return rightEnd - leftEnd;
    });
  const manual = databaseBoolean(profile?.is_pro);
  const legacyStatus = typeof profile?.subscription_status === "string" ? profile.subscription_status : null;
  const legacyStripeAccess =
    Boolean(profile?.stripe_customer_id) && (legacyStatus === "active" || legacyStatus === "trialing");
  const primary = active[0] ?? null;
  const isPro = manual || Boolean(primary) || legacyStripeAccess;

  return {
    isPro,
    status: primary?.status ?? (legacyStripeAccess ? legacyStatus : manual ? "manual" : legacyStatus),
    primaryProvider: primary?.provider ?? (legacyStripeAccess ? "stripe" : manual ? "manual" : null),
    activeProviders: [...new Set(active.map((item) => item.provider))],
    plan: primary?.plan ?? null,
    productId: primary?.product_id ?? null,
    currentPeriodEnd: primary?.current_period_end ?? null,
    canPurchase: !isPro,
  };
}
