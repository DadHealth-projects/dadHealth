import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { upsertSubscriptionEntitlement } from "@/lib/native-subscriptions/store";

export async function syncUserProfile(
  userId: string,
  fields: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    subscription_status?: string | null;
    current_period_end?: string | null;
    auto_renews?: boolean | null;
    last_verified_at?: string;
  }
) {
  if (!fields.stripe_subscription_id || !fields.subscription_status) return;

  await upsertSubscriptionEntitlement(createAdminSupabaseClient(), {
    userId,
    provider: "stripe",
    providerSubscriptionId: fields.stripe_subscription_id,
    providerAccountId: fields.stripe_customer_id ?? null,
    status: fields.subscription_status,
    currentPeriodEnd: fields.current_period_end ?? null,
    autoRenews: fields.auto_renews ?? null,
    environment: process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ? "test" : "production",
    lastVerifiedAt: fields.last_verified_at ?? new Date().toISOString(),
  });
}
