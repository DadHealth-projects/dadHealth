import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { createServerSupabaseClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

const BUCKET = "profile-photos";

async function requireUser(req: NextRequest) {
  const browserClient = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();
  const bearerToken = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const result = bearerToken ? await admin.auth.getUser(bearerToken) : await browserClient.auth.getUser();
  return result.data.user ?? null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Upload a valid image under 5 MB" }, { status: 400 });
  }
  const output = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "none" })
    .rotate()
    .resize({ width: 800, height: 800, fit: "cover", position: "centre" })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  const admin = createAdminSupabaseClient();
  const path = `${user.id}/avatar.jpg`;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, output, { contentType: "image/jpeg", cacheControl: "3600", upsert: true });
  if (uploadError) return NextResponse.json({ error: "Unable to save profile photo" }, { status: 500 });
  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path);
  const avatarUrl = `${publicUrl}?v=${Date.now()}`;
  const { error: updateError } = await admin.from("user_profile").update({ avatar_url: avatarUrl }).eq("user_id", user.id);
  if (updateError) return NextResponse.json({ error: "Unable to update profile" }, { status: 500 });
  await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, dadhealth_avatar_url: avatarUrl } });
  return NextResponse.json({ avatar_url: avatarUrl });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const admin = createAdminSupabaseClient();
  const { error: removeError } = await admin.storage.from(BUCKET).remove([`${user.id}/avatar.jpg`]);
  if (removeError) return NextResponse.json({ error: "Unable to remove profile photo" }, { status: 500 });
  const { error: updateError } = await admin.from("user_profile").update({ avatar_url: null }).eq("user_id", user.id);
  if (updateError) return NextResponse.json({ error: "Unable to update profile" }, { status: 500 });
  await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, dadhealth_avatar_url: null } });
  return NextResponse.json({ ok: true });
}
