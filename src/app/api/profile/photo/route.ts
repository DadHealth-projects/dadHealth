import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { createServerSupabaseClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

const BUCKET = "profile-photos";

const MAX_PHOTO_SIZE = 20 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "jpeg",
  "png",
  "heif",
]);

const ALLOWED_DECLARED_MIME_TYPES = new Set([
  "application/octet-stream",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
]);

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

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_photo" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_SIZE) {
    return NextResponse.json({ error: "photo_too_large" }, { status: 413 });
  }

  const declaredMimeType = file.type.toLowerCase();
  if (declaredMimeType && !ALLOWED_DECLARED_MIME_TYPES.has(declaredMimeType)) {
    return NextResponse.json({ error: "unsupported_image_format" }, { status: 415 });
  }

  let output: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { failOn: "error" });
    const metadata = await image.metadata();

    if (!metadata.format || !ALLOWED_IMAGE_TYPES.has(metadata.format)) {
      return NextResponse.json({ error: "unsupported_image_format" }, { status: 415 });
    }

    output = await image
      .rotate()
      .resize({ width: 800, height: 800, fit: "cover", position: "centre" })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "image_processing_failed" }, { status: 422 });
  }
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
