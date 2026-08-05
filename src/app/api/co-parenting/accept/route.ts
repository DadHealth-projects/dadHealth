import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { verifyInviteToken } from "@/lib/coParenting/inviteToken";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // 1. Use server client ONLY for auth
  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();
  const bearerToken = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const authResult = bearerToken ? await admin.auth.getUser(bearerToken) : await supabase.auth.getUser();
  const user = authResult.data.user;

  if (!user) {
    return NextResponse.json(
      { error: "Sign in to accept this invite" },
      { status: 401 }
    );
  }

  // 2. Parse request body
  const body = (await req.json().catch(() => ({}))) as {
    token?: unknown;
  };

  const token = typeof body.token === "string" ? body.token : "";

  // 3. Verify invite token
  const payload = verifyInviteToken(token);

  if (!payload) {
    return NextResponse.json(
      { error: "This invite link is invalid or has expired" },
      { status: 400 }
    );
  }

  // 4. Email must match invite target
  if ((user.email ?? "").toLowerCase() !== payload.email) {
    return NextResponse.json(
      { error: "This invite was sent to a different email address" },
      { status: 403 }
    );
  }

  // 5. Prevent self-invite
  if (user.id === payload.dadUserId) {
    return NextResponse.json(
      { error: "You can't accept your own invite" },
      { status: 400 }
    );
  }

  // 6. Use ADMIN client for cross-user writes (bypasses RLS)
  // Link co-parent in schedule
  const { error: scheduleError } = await admin
    .from("co_parenting_schedules")
    .update({ co_parent_user_id: user.id })
    .eq("user_id", payload.dadUserId);

  if (scheduleError) {
    return NextResponse.json(
      { error: "Unable to link the shared calendar" },
      { status: 500 }
    );
  }

  // Link profile
  const { error: profileError } = await admin
    .from("user_profile")
    .update({ co_parent_id: user.id })
    .eq("user_id", payload.dadUserId);

  if (profileError) {
    return NextResponse.json(
      { error: "Unable to link the co-parent account" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
