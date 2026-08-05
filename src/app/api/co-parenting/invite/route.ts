import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { signInviteToken } from "@/lib/coParenting/inviteToken";
import { sendEmail } from "@/lib/email/resend";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inviteEmailHtml(inviteUrl: string, appInviteUrl: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="font-weight: 800;">You've been invited to share a parenting calendar</h2>
      <p style="color: #444; line-height: 1.5;">
        A parenting partner has invited you to view their shared calendar on Dad Health —
        including custody dates, handover times and upcoming events. This is a read-only view.
      </p>
      <p style="margin: 28px 0;">
        <a href="${appInviteUrl}"
           style="background: #b6e94f; color: #0a0a0a; font-weight: 700; text-decoration: none;
                  padding: 12px 22px; border-radius: 6px; display: inline-block;">
          Open Dad Health app
        </a>
      </p>
      <p style="color: #666; font-size: 13px;">
        App not installed? <a href="${inviteUrl}">Accept on the Dad Health website</a>.
      </p>
      <p style="color: #888; font-size: 13px;">This invite link expires in 7 days.</p>
    </div>
  `;
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();
  const bearerToken = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const authResult = bearerToken ? await admin.auth.getUser(bearerToken) : await supabase.auth.getUser();
  const user = authResult.data.user;

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (email === user.email?.toLowerCase()) {
    return NextResponse.json({ error: "You can't invite yourself" }, { status: 400 });
  }

  // Ensure the dad has a schedule row (the container the co-parent links to).
  const dataClient = bearerToken ? admin : supabase;
  const { data: existing, error: selectError } = await dataClient
    .from("co_parenting_schedules")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: "Unable to read schedule" }, { status: 500 });
  }

  if (!existing) {
    const { error: insertError } = await dataClient
      .from("co_parenting_schedules")
      .insert({ user_id: user.id });
    if (insertError) {
      return NextResponse.json({ error: "Unable to create schedule" }, { status: 500 });
    }
  }

  const token = signInviteToken({ dadUserId: user.id, email });
  const inviteUrl = `${getSiteUrl()}/bond?section=coparenting&token=${encodeURIComponent(token)}`;
  const appInviteUrl = `dadhealth://shared-calendar?token=${encodeURIComponent(token)}`;

  try {
    await sendEmail({
      to: email,
      subject: "You've been invited to share a parenting calendar",
      html: inviteEmailHtml(inviteUrl, appInviteUrl),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send invite email";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });

}
