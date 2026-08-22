import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

type Params = { resource: string };

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key);
}

async function verifyAdmin(): Promise<boolean> {
  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey) return false;
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  return session === adminKey;
}

const CIRCLE_ICON_KEYS = new Set([
  "community",
  "baby",
  "grad",
  "fitness",
  "mind",
  "bond",
  "gaming",
  "camping",
  "kickabout",
  "run",
  "story",
  "journal",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CircleWriteResult =
  | { ok: true; value: { id?: string; name: string; icon: string } }
  | { ok: false; error: string };

type ChallengeWriteResult =
  | { ok: true; value: { id?: string; title: string; description: string } }
  | { ok: false; error: string };

function parseCircleWrite(body: unknown, requireId: boolean): CircleWriteResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Circle details are required." };
  }

  const record = body as Record<string, unknown>;
  const allowedKeys = new Set(requireId ? ["id", "name", "icon"] : ["name", "icon"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "Only Circle name and icon can be changed." };
  }

  const name = typeof record.name === "string" ? record.name.trim() : "";
  const icon = typeof record.icon === "string" ? record.icon.trim() : "";
  if (!name) return { ok: false, error: "Circle name is required." };
  if (!CIRCLE_ICON_KEYS.has(icon)) return { ok: false, error: "Choose a supported Circle icon." };

  if (!requireId) return { ok: true, value: { name, icon } };

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "A valid Circle ID is required." };
  return { ok: true, value: { id, name, icon } };
}

function parseCircleId(body: unknown): { ok: true; id: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A valid Circle ID is required." };
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "id")) {
    return { ok: false, error: "Only the Circle ID can be supplied when deleting." };
  }
  const id = typeof record.id === "string" ? record.id.trim() : "";
  return UUID_PATTERN.test(id)
    ? { ok: true, id }
    : { ok: false, error: "A valid Circle ID is required." };
}

function parseChallengeWrite(body: unknown, requireId: boolean): ChallengeWriteResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Challenge details are required." };
  }

  const record = body as Record<string, unknown>;
  const allowedKeys = new Set(requireId ? ["id", "title", "description"] : ["title", "description"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "Only the challenge title and description can be changed." };
  }

  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) return { ok: false, error: "Challenge title is required." };
  if (record.description == null) {
    return { ok: false, error: "Challenge description is required." };
  }
  if (typeof record.description !== "string") {
    return { ok: false, error: "Challenge description must be text." };
  }
  const description = record.description.trim();
  if (!description) return { ok: false, error: "Challenge description is required." };

  if (!requireId) return { ok: true, value: { title, description } };

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "A valid challenge ID is required." };
  return { ok: true, value: { id, title, description } };
}

function parseChallengeActive(
  body: unknown,
): { ok: true; id: string; active: boolean } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Challenge active state is required." };
  }

  const record = body as Record<string, unknown>;
  const allowedKeys = new Set(["id", "active"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "Only the challenge active state can be changed in this request." };
  }

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "A valid challenge ID is required." };
  if (typeof record.active !== "boolean") {
    return { ok: false, error: "Challenge active state must be true or false." };
  }
  return { ok: true, id, active: record.active };
}

function parseChallengeId(body: unknown): { ok: true; id: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A valid challenge ID is required." };
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "id")) {
    return { ok: false, error: "Only the challenge ID can be supplied when deleting." };
  }
  const id = typeof record.id === "string" ? record.id.trim() : "";
  return UUID_PATTERN.test(id)
    ? { ok: true, id }
    : { ok: false, error: "A valid challenge ID is required." };
}

// Query PostHog for distinct visitors over the last 7 days via HogQL.
// Returns null if env vars are missing or the request fails — never throws,
// so analytics stays responsive even when PostHog is unavailable.
async function fetchPosthogPageviews7d(): Promise<number | null> {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) return null;

  const host = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/$/, "");

  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: {
          kind: "HogQLQuery",
          query:
            "SELECT count(distinct person_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - interval 7 day",
        },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const value = json?.results?.[0]?.[0];
    return typeof value === "number" ? value : Number(value) || 0;
  } catch (err) {
    console.error("[admin analytics posthog]", err);
    return null;
  }
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  context: { params: Promise<Params> },
) {
  const ok = await verifyAdmin();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { resource } = await context.params;
  const supabase = getAdminSupabase();

  try {
    switch (resource) {
      case "challenges": {
        const { data, error } = await supabase
          .from("weekly_challenges")
          .select("id, title, description, active, created_at")
          .order("active", { ascending: false })
          .order("created_at", { ascending: false });
        if (error) throw error;
        return NextResponse.json(data ?? []);
      }

      case "recipes": {
        const { data, error } = await supabase
          .from("recipes")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "workouts": {
        const { data, error } = await supabase
          .from("workouts")
          .select("*")
          .eq("source", "admin")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "therapists": {
        const { data, error } = await supabase
          .from("therapists")
          .select("*")
          .order("name");
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "dad_dates": {
        const { data, error } = await supabase
          .from("dad_dates")
          .select("*")
          .order("name");
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "circles": {
        const { data, error } = await supabase
          .from("circles")
          .select("id, name, icon, members_count")
          .order("name", { ascending: true });
        if (error) throw error;
        return NextResponse.json(data ?? []);
      }

      case "expert_events": {
        const { data, error } = await supabase
          .from("expert_events")
          .select("*")
          .order("event_date", { ascending: true });
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "posts": {
        const { data, error } = await supabase
          .from("posts")
          .select("id, content, tag, anonymous, author_name, author_meta, created_at, user_id")
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "analytics": {
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
          .toISOString()
          .slice(0, 10);

        // Run all counts in parallel
        const [dauRes, proRes, weeklyCheckinsRes, totalUsersRes, workoutsRes] =
          await Promise.all([
            // DAU: distinct users with a mood log today
            supabase
              .from("mood_logs")
              .select("user_id", { count: "exact", head: true })
              .eq("date", todayStr),
            // Pro: active or trialing subscriptions
            supabase
              .from("user_profile")
              .select("user_id", { count: "exact", head: true })
              .in("subscription_status", ["active", "trialing"]),
            // Check-ins: mood logs in last 7 days (distinct by date+user)
            supabase
              .from("mood_logs")
              .select("user_id", { count: "exact", head: true })
              .gte("date", weekAgo),
            // Total registered users
            supabase
              .from("user_profile")
              .select("user_id", { count: "exact", head: true }),
            // Workouts logged this week
            supabase
              .from("workout_sessions")
              .select("user_id", { count: "exact", head: true })
              .gte("performed_at", new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString()),
          ]);

        // PostHog enrichment: distinct visitors over the last 7 days.
        // Non-blocking — returns null if env vars are unset or the request fails.
        const pageviews_7d = await fetchPosthogPageviews7d();

        return NextResponse.json({
          dau: dauRes.count ?? 0,
          pro_users: proRes.count ?? 0,
          checkins_this_week: weeklyCheckinsRes.count ?? 0,
          total_users: totalUsersRes.count ?? 0,
          workouts_this_week: workoutsRes.count ?? 0,
          pageviews_7d,
        });
      }

      default:
        return NextResponse.json({ error: "Unknown resource" }, { status: 404 });
    }
  } catch (err) {
    console.error(`[admin GET ${resource}]`, err);
    if (resource === "challenges") {
      return NextResponse.json({ error: "Weekly challenges could not be loaded. Please try again." }, { status: 500 });
    }
    if (resource === "circles") {
      return NextResponse.json({ error: "Dad Circles could not be loaded. Please try again." }, { status: 500 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── POST (create) ────────────────────────────────────────────────────────────

export async function POST(
  req: Request,
  context: { params: Promise<Params> },
) {
  const ok = await verifyAdmin();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { resource } = await context.params;
  const supabase = getAdminSupabase();
  const body = await req.json();

  try {
    switch (resource) {
      case "challenges": {
        const parsed = parseChallengeWrite(body, false);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

        const { data, error } = await supabase
          .from("weekly_challenges")
          .insert({
            title: parsed.value.title,
            description: parsed.value.description,
            active: false,
          })
          .select("id, title, description, active, created_at")
          .single();
        if (error) throw error;
        return NextResponse.json(data, { status: 201 });
      }

      case "recipes": {
        const { data, error } = await supabase
          .from("recipes")
          .insert({
            title: body.title,
            description: body.description ?? null,
            difficulty: body.difficulty,
            age_min: body.age_min,
            prep_mins: body.prep_mins,
            ingredients: body.ingredients ?? [],
            steps: body.steps ?? [],
            cook_together: body.cook_together ?? true,
            image_url: body.image_url ?? null,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "workouts": {
        const { data, error } = await supabase
          .from("workouts")
          .insert({
            user_id: null,
            title: body.title,
            duration_mins: body.duration_mins,
            equipment: body.equipment,
            focus: body.focus,
            exercises: body.exercises ?? [],
            source: "admin",
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "therapists": {
        const { data, error } = await supabase
          .from("therapists")
          .insert({
            name: body.name,
            spec: body.spec ?? null,
            availability: body.availability ?? null,
            price_per_hour: body.price_per_hour,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "dad_dates": {
        const { data, error } = await supabase
          .from("dad_dates")
          .insert({
            icon: body.icon,
            name: body.name,
            age_range: body.age_range,
            budget: body.budget,
            duration_minutes: body.duration_minutes,
            time_of_day: body.time_of_day ?? null,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json(data);
      }

      case "circles": {
        const parsed = parseCircleWrite(body, false);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

        const { data, error } = await supabase
          .from("circles")
          .insert(parsed.value)
          .select("id, name, icon, members_count")
          .single();
        if (error) throw error;
        return NextResponse.json(data, { status: 201 });
      }

      case "expert_events": {
        const { data, error } = await supabase
          .from("expert_events")
          .insert({
            title: body.title,
            description: body.description ?? null,
            expert_name: body.expert_name,
            event_date: body.event_date,
            booking_url: body.booking_url ?? null,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json(data);
      }

      default:
        return NextResponse.json({ error: "Unknown resource" }, { status: 404 });
    }
  } catch (err) {
    console.error(`[admin POST ${resource}]`, err);
    if (resource === "challenges") {
      return NextResponse.json({ error: "This weekly challenge could not be created. Please try again." }, { status: 500 });
    }
    if (resource === "circles") {
      return NextResponse.json({ error: "This Circle could not be created. Please try again." }, { status: 500 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── PATCH (update) ───────────────────────────────────────────────────────────

export async function PATCH(
  req: Request,
  context: { params: Promise<Params> },
) {
  const ok = await verifyAdmin();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { resource } = await context.params;
  const supabase = getAdminSupabase();
  const body = await req.json();

  if (resource === "challenges") {
    if (body && typeof body === "object" && !Array.isArray(body) && "active" in body) {
      const parsed = parseChallengeActive(body);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

      try {
        const { data, error } = await supabase
          .rpc("set_active_weekly_challenge", {
            p_challenge_id: parsed.id,
            p_active: parsed.active,
          })
          .select("id, title, description, active, created_at")
          .maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "This weekly challenge no longer exists." }, { status: 404 });
        return NextResponse.json(data);
      } catch (err) {
        console.error("[admin PATCH challenges active]", err);
        return NextResponse.json(
          { error: parsed.active ? "This weekly challenge could not be made active. Please try again." : "This weekly challenge could not be deactivated. Please try again." },
          { status: 500 },
        );
      }
    }

    const parsed = parseChallengeWrite(body, true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { id, ...updates } = parsed.value;

    try {
      const { data, error } = await supabase
        .from("weekly_challenges")
        .update(updates)
        .eq("id", id!)
        .select("id, title, description, active, created_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This weekly challenge no longer exists." }, { status: 404 });
      return NextResponse.json(data);
    } catch (err) {
      console.error("[admin PATCH challenges content]", err);
      return NextResponse.json({ error: "This weekly challenge could not be updated. Please try again." }, { status: 500 });
    }
  }

  if (resource === "circles") {
    const parsed = parseCircleWrite(body, true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { id, ...updates } = parsed.value;

    try {
      const { data, error } = await supabase
        .from("circles")
        .update(updates)
        .eq("id", id!)
        .select("id, name, icon, members_count")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This Circle no longer exists." }, { status: 404 });
      return NextResponse.json(data);
    } catch (err) {
      console.error("[admin PATCH circles]", err);
      return NextResponse.json({ error: "This Circle could not be updated. Please try again." }, { status: 500 });
    }
  }

  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const TABLE_MAP: Record<string, string> = {
    recipes: "recipes",
    workouts: "workouts",
    therapists: "therapists",
    dad_dates: "dad_dates",
    expert_events: "expert_events",
  };

  const table = TABLE_MAP[resource];
  if (!table) return NextResponse.json({ error: "Unknown resource" }, { status: 404 });

  try {
    const { data, error } = await supabase
      .from(table)
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error(`[admin PATCH ${resource}]`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  req: Request,
  context: { params: Promise<Params> },
) {
  const ok = await verifyAdmin();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { resource } = await context.params;
  const supabase = getAdminSupabase();
  const body = await req.json();
  const { id } = body;

  if (resource === "challenges") {
    const parsed = parseChallengeId(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    try {
      const { data, error } = await supabase
        .from("weekly_challenges")
        .delete()
        .eq("id", parsed.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This weekly challenge no longer exists." }, { status: 404 });
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[admin DELETE challenges]", err);
      return NextResponse.json({ error: "This weekly challenge could not be deleted. Please try again." }, { status: 500 });
    }
  }

  if (resource === "circles") {
    const parsed = parseCircleId(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    try {
      const { data, error } = await supabase
        .from("circles")
        .delete()
        .eq("id", parsed.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "This Circle no longer exists." }, { status: 404 });
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[admin DELETE circles]", err);
      return NextResponse.json({ error: "This Circle could not be deleted. Please try again." }, { status: 500 });
    }
  }

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Banning a user: delete their auth account. FK cascades remove all their data.
  if (resource === "users") {
    try {
      const { error } = await supabase.auth.admin.deleteUser(id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error(`[admin DELETE users]`, err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  const TABLE_MAP: Record<string, string> = {
    recipes: "recipes",
    workouts: "workouts",
    therapists: "therapists",
    dad_dates: "dad_dates",
    expert_events: "expert_events",
    posts: "posts",
  };

  const table = TABLE_MAP[resource];
  if (!table) return NextResponse.json({ error: "Unknown resource" }, { status: 404 });

  try {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[admin DELETE ${resource}]`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
