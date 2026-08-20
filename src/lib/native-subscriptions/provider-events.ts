import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import type { SubscriptionEnvironment, SubscriptionProvider } from "./types";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function claimProviderEvent(
  admin: AdminClient,
  provider: SubscriptionProvider,
  eventId: string,
  eventType: string,
  environment: SubscriptionEnvironment,
): Promise<string | null> {
  const { data, error } = await admin.rpc("claim_subscription_provider_event", {
    p_provider: provider,
    p_event_id: eventId,
    p_event_type: eventType,
    p_environment: environment,
  });
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

export async function completeProviderEvent(admin: AdminClient, claimId: string): Promise<void> {
  const { error } = await admin.rpc("complete_subscription_provider_event", {
    p_claim_id: claimId,
  });
  if (error) throw error;
}

export async function failProviderEvent(
  admin: AdminClient,
  claimId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await admin.rpc("fail_subscription_provider_event", {
    p_claim_id: claimId,
    p_error_code: errorCode,
  });
  if (error) throw error;
}
