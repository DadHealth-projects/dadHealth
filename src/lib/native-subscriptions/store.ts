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

export async function getCanonicalWeekStart(admin: AdminClient, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("dad_score_history_view")
    .select("week_start")
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (typeof data?.week_start !== "string") throw new Error("Canonical score week is unavailable");
  return data.week_start;
}

export async function getCurrentWeekFreezeState(admin: AdminClient, userId: string) {
  const weekStart = await getCanonicalWeekStart(admin, userId);
  const { data, error } = await admin
    .from("user_streak_freezes")
    .select("missed_date")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  const freezeUsedThisWeek = Boolean(data);
  return { freezeUsedThisWeek, freezesRemaining: freezeUsedThisWeek ? 0 : 1 };
}

function databaseBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export async function getSubscriptionSummary(
  admin: AdminClient,
  userId: string,
): Promise<SubscriptionSummary> {
  const [
    { data: profile, error: profileError },
    { data: rows, error: entitlementsError },
    { data: canonicalProAccess, error: accessError },
  ] =
    await Promise.all([
      admin
        .from("user_profile")
        .select("is_pro, subscription_status, stripe_customer_id, stripe_subscription_id")
        .eq("user_id", userId)
        .maybeSingle(),
      admin.from("subscription_entitlements").select("*").eq("user_id", userId),
      admin.rpc("user_has_pro_access", { p_user_id: userId }),
    ]);

  if (profileError) throw profileError;
  if (entitlementsError) throw entitlementsError;
  if (accessError) throw accessError;

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
  // The database predicate is also used by authoritative streak processing.
  // Keep this server summary as the shared resolver for API and UI consumers.
  const isPro = canonicalProAccess === true;

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
