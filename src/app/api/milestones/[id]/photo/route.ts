import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import { isProfilePro } from "@/lib/stripe/subscription";
import {
  MILESTONE_PHOTO_BUCKET,
  MILESTONE_PHOTO_MAX_EDGE,
  milestonePhotoPath,
} from "@/lib/milestonePhotos";

export const runtime = "nodejs";

type Params = { id: string };

async function requireProUser(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();
  const bearerToken = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const authResult = bearerToken
    ? await admin.auth.getUser(bearerToken)
    : await supabase.auth.getUser();
  const user = authResult.data.user;

  if (!user) return { error: "Not authenticated", status: 401 as const };

  const profileClient = bearerToken ? admin : supabase;
  const { data: profile } = await profileClient
    .from("user_profile")
    .select("is_pro,subscription_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isProfilePro(profile)) {
    return { error: "Milestone photos are a Pro feature", status: 403 as const };
  }

  return { user };
}

async function getOwnedMilestone(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string, milestoneId: string) {
  const { data, error } = await admin
    .from("milestones")
    .select("id,user_id,photo_url")
    .eq("id", milestoneId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<Params> }
) {
  const auth = await requireProUser(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  const form = await req.formData();
  const file = form.get("photo");

  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Upload a valid image file" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const milestone = await getOwnedMilestone(admin, auth.user.id, id);
  if (!milestone) {
    return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  }

  const input = Buffer.from(await file.arrayBuffer());
  const output = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: MILESTONE_PHOTO_MAX_EDGE,
      height: MILESTONE_PHOTO_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const path = milestonePhotoPath(auth.user.id, id);
  const { error: uploadError } = await admin.storage
    .from(MILESTONE_PHOTO_BUCKET)
    .upload(path, output, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) {
    return NextResponse.json({ error: "Unable to save milestone photo" }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(MILESTONE_PHOTO_BUCKET).getPublicUrl(path);

  const versionedUrl = `${publicUrl}?v=${Date.now()}`;
  const { error: updateError } = await admin
    .from("milestones")
    .update({ photo_url: versionedUrl })
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (updateError) {
    return NextResponse.json({ error: "Unable to update milestone" }, { status: 500 });
  }

  return NextResponse.json({ photo_url: versionedUrl });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<Params> }
) {
  const auth = await requireProUser(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  const admin = createAdminSupabaseClient();
  const milestone = await getOwnedMilestone(admin, auth.user.id, id);
  if (!milestone) {
    return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  }

  const path = milestonePhotoPath(auth.user.id, id);
  const { error: removeError } = await admin.storage.from(MILESTONE_PHOTO_BUCKET).remove([path]);
  if (removeError) {
    return NextResponse.json({ error: "Unable to delete milestone photo" }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("milestones")
    .update({ photo_url: null })
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (updateError) {
    return NextResponse.json({ error: "Unable to update milestone" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
