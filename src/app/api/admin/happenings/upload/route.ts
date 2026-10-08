import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { HAPPENING_IMAGE_BUCKET, happeningImagePath } from "@/lib/happenings";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";

const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function verifyAdmin() {
  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey) return false;
  return (await cookies()).get("admin_session")?.value === adminKey;
}

function hasValidSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  }
  if (mime === "image/webp") {
    return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

export async function POST(req: Request) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Image is required." }, { status: 400 });
    if (!EXTENSIONS[file.type]) {
      return NextResponse.json({ error: "Unsupported processed image type. Use JPEG, PNG or WebP." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Image file is empty." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasValidSignature(bytes, file.type)) {
      return NextResponse.json({ error: "Image file content is invalid." }, { status: 400 });
    }

    const path = `${randomUUID()}.${EXTENSIONS[file.type]}`;
    const supabase = createAdminSupabaseClient();
    const { error } = await supabase.storage
      .from(HAPPENING_IMAGE_BUCKET)
      .upload(path, bytes, { contentType: file.type, cacheControl: "3600", upsert: false });
    if (error) throw error;

    const { data } = supabase.storage.from(HAPPENING_IMAGE_BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl }, { status: 201 });
  } catch (error) {
    console.error("[admin happenings upload]", error);
    return NextResponse.json({ error: "Upload failed. Please check your connection and try again." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { url?: unknown };
  try {
    body = await req.json() as { url?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  }

  const imageUrl = typeof body.url === "string" ? body.url : null;
  const path = happeningImagePath(imageUrl);
  if (!path || !imageUrl) {
    return NextResponse.json({ error: "A valid Happening image URL is required." }, { status: 400 });
  }

  try {
    const supabase = createAdminSupabaseClient();
    const { data: reference, error: referenceError } = await supabase
      .from("homepage_happenings")
      .select("id")
      .eq("image_url", imageUrl)
      .limit(1)
      .maybeSingle();
    if (referenceError) throw referenceError;
    if (reference) {
      return NextResponse.json(
        { error: "This image belongs to a saved Happening post." },
        { status: 409 },
      );
    }

    const { error } = await supabase.storage
      .from(HAPPENING_IMAGE_BUCKET)
      .remove([path]);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin happenings upload DELETE]", error);
    return NextResponse.json({ error: "Image could not be removed." }, { status: 500 });
  }
}
