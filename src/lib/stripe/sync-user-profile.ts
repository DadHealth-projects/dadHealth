import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { upsertSubscriptionEntitlement } from "@/lib/native-subscriptions/store";

const DAD_HEALTH_CLIENT_ID = "00000000-0000-0000-0000-000000000001";

export async function syncUserProfile(
  userId: string,
  fields: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    subscription_status?: string | null;
  }
) {
  const admin = createAdminSupabaseClient();

  const { data: row } = await admin.from("user_profile").select("id").eq("user_id", userId).maybeSingle();

  const payload = {
    ...fields,
    updated_at: new Date().toISOString(),
  };

  if (row) {
    const { error } = await admin.from("user_profile").update(payload).eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await admin.from("user_profile").insert({
      user_id: userId,
      client_id: DAD_HEALTH_CLIENT_ID,
      ...payload,
    });
    if (error) throw error;
  }

  if (fields.stripe_subscription_id && fields.subscription_status) {
    await upsertSubscriptionEntitlement(admin, {
      userId,
      provider: "stripe",
      providerSubscriptionId: fields.stripe_subscription_id,
      providerAccountId: fields.stripe_customer_id ?? null,
      status: fields.subscription_status,
      environment: process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ? "test" : "production",
      lastVerifiedAt: new Date().toISOString(),
    });
  }
}
