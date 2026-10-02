import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import {
  HAPPENING_IMAGE_BUCKET,
  HAPPENING_SELECT,
  MAX_LIVE_HAPPENINGS,
  happeningImagePath,
  parseHappeningWrite,
} from "@/lib/happenings";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function verifyAdmin() {
  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey) return false;
  return (await cookies()).get("admin_session")?.value === adminKey;
}

async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false };
  }
}

function readId(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const id = (input as Record<string, unknown>).id;
  return typeof id === "string" && UUID_PATTERN.test(id) ? id : null;
}

async function liveLimitReached(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  excludeId?: string,
) {
  let query = supabase
    .from("homepage_happenings")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .gt("show_until", new Date().toISOString());
  if (excludeId) query = query.neq("id", excludeId);
  const { count, error } = await query;
  if (error) throw error;
  return (count ?? 0) >= MAX_LIVE_HAPPENINGS;
}

class ImageCleanupError extends Error {
  constructor() {
    super("Happening image cleanup failed");
    this.name = "ImageCleanupError";
  }
}

async function removeImage(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  imageUrl: string | null,
) {
  const path = happeningImagePath(imageUrl);
  if (!path) return;
  const { error } = await supabase.storage.from(HAPPENING_IMAGE_BUCKET).remove([path]);
  if (error) {
    console.error("[admin happenings image cleanup]", error);
    throw new ImageCleanupError();
  }
}

function writeError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  if (candidate?.code === "23514" && candidate.message?.includes("homepage_happenings_live_limit")) {
    return NextResponse.json({ error: "Only three Happening posts can be live at once." }, { status: 409 });
  }
  console.error("[admin happenings]", error);
  return NextResponse.json({ error: "Happening post could not be saved." }, { status: 500 });
}

export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { data, error } = await createAdminSupabaseClient()
      .from("homepage_happenings")
      .select(HAPPENING_SELECT)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("[admin happenings GET]", error);
    return NextResponse.json({ error: "Happening posts could not be loaded." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const json = await readJson(req);
  if (!json.ok) return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  const parsed = parseHappeningWrite(json.value);
  if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = createAdminSupabaseClient();
  try {
    if (parsed.value.active && new Date(parsed.value.show_until) > new Date() && await liveLimitReached(supabase)) {
      return NextResponse.json({ error: "Only three Happening posts can be live at once." }, { status: 409 });
    }
    const { data, error } = await supabase
      .from("homepage_happenings")
      .insert(parsed.value)
      .select(HAPPENING_SELECT)
      .single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return writeError(error);
  }
}

export async function PATCH(req: Request) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const json = await readJson(req);
  if (!json.ok) return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  const id = readId(json.value);
  if (!id) return NextResponse.json({ error: "A valid Happening ID is required." }, { status: 400 });

  const record = json.value as Record<string, unknown>;
  const { id: _id, ...writeInput } = record;
  const parsed = parseHappeningWrite(writeInput);
  if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = createAdminSupabaseClient();
  try {
    const { data: existing, error: existingError } = await supabase
      .from("homepage_happenings")
      .select("id,image_url")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: "Happening post not found." }, { status: 404 });

    if (parsed.value.active && new Date(parsed.value.show_until) > new Date() && await liveLimitReached(supabase, id)) {
      return NextResponse.json({ error: "Only three Happening posts can be live at once." }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("homepage_happenings")
      .update(parsed.value)
      .eq("id", id)
      .select(HAPPENING_SELECT)
      .single();
    if (error) throw error;
    if (existing.image_url && existing.image_url !== parsed.value.image_url) {
      await removeImage(supabase, existing.image_url);
    }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ImageCleanupError) {
      return NextResponse.json(
        { error: "Happening post was updated, but its previous image could not be removed." },
        { status: 500 },
      );
    }
    return writeError(error);
  }
}

export async function DELETE(req: Request) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const json = await readJson(req);
  if (!json.ok) return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  const id = readId(json.value);
  if (!id) return NextResponse.json({ error: "A valid Happening ID is required." }, { status: 400 });
  if (Object.keys(json.value as Record<string, unknown>).some((key) => key !== "id")) {
    return NextResponse.json({ error: "Only the Happening ID can be supplied." }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("homepage_happenings")
      .delete()
      .eq("id", id)
      .select("id,image_url")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Happening post not found." }, { status: 404 });
    await removeImage(supabase, data.image_url);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ImageCleanupError) {
      return NextResponse.json(
        { error: "Happening post was deleted, but its image could not be removed." },
        { status: 500 },
      );
    }
    console.error("[admin happenings DELETE]", error);
    return NextResponse.json({ error: "Happening post could not be deleted." }, { status: 500 });
  }
}
