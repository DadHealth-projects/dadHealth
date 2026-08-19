import { sendOneSignalToExternalUserId } from "@/lib/notifications/onesignal";
import type { NotificationPayload } from "@/lib/notifications/types";
import type { NotificationType } from "@/types/database";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function sendRateLimitedNotification(args: {
  admin: AdminClient;
  userId: string;
  type: NotificationType;
  timezone: string;
  payload: NotificationPayload;
}): Promise<"sent" | "limited"> {
  const claimResult = await args.admin.rpc("claim_notification_delivery", {
    p_user_id: args.userId,
    p_type: args.type,
    p_timezone: args.timezone,
  });
  if (claimResult.error) throw claimResult.error;
  if (typeof claimResult.data !== "string" || !claimResult.data) {
    console.info("[notifications/delivery] Delivery skipped by rate limit", {
      user: args.userId.slice(0, 8),
      type: args.type,
    });
    return "limited";
  }

  const claimId = claimResult.data;
  console.info("[notifications/delivery] Sending claimed notification", {
    claim: claimId.slice(0, 8),
    user: args.userId.slice(0, 8),
    type: args.type,
  });
  const delivery = await sendOneSignalToExternalUserId({
    externalUserId: args.userId,
    payload: args.payload,
    idempotencyKey: claimId,
  });

  const completionResult = await args.admin.rpc("complete_notification_delivery", {
    p_claim_id: claimId,
    p_provider_message_id: delivery.id,
  });
  if (completionResult.error) throw completionResult.error;
  if (completionResult.data !== true) {
    throw new Error("Notification delivery could not be finalized");
  }

  console.info("[notifications/delivery] Notification sent and recorded", {
    claim: claimId.slice(0, 8),
    user: args.userId.slice(0, 8),
    type: args.type,
    providerMessage: delivery.id.slice(0, 8),
  });

  return "sent";
}
