import type { User } from "@supabase/supabase-js";

import { createAdminSupabaseClient } from "@/utils/supabase/admin";

export interface NativeSubscriptionAuth {
  user: User;
  admin: ReturnType<typeof createAdminSupabaseClient>;
}

export async function authenticateNativeSubscriptionRequest(
  request: Request,
): Promise<NativeSubscriptionAuth | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, admin };
}
