import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

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
  return cookieStore.get("admin_session")?.value === adminKey;
}

function currentMondayDateUtc(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const supabase = getAdminSupabase();
    const [recipesResult, assignmentsResult] = await Promise.all([
      supabase
        .from("recipes")
        .select("id, title")
        .eq("cook_together", true)
        .order("title", { ascending: true }),
      supabase
        .from("free_weekly_recipe_assignments")
        .select("week_start, recipe_id")
        .gte("week_start", currentMondayDateUtc())
        .order("week_start", { ascending: true })
        .limit(52),
    ]);
    if (recipesResult.error) throw recipesResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    const recipeTitles = new Map((recipesResult.data ?? []).map((recipe) => [recipe.id, recipe.title]));
    const assignments = (assignmentsResult.data ?? []).map((row) => ({
      week_start: row.week_start,
      recipe_id: row.recipe_id,
      recipe_title: recipeTitles.get(row.recipe_id) ?? "Unavailable recipe",
    }));

    return NextResponse.json({ recipes: recipesResult.data ?? [], assignments });
  } catch (error) {
    console.error("[admin weekly recipe GET]", error);
    return NextResponse.json({ error: "Weekly Cook Together recipes could not be loaded." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Choose a Cook Together recipe and Monday week start." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Choose a Cook Together recipe and Monday week start." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const weekStart = typeof record.week_start === "string" ? record.week_start : "";
  const recipeId = typeof record.recipe_id === "string" ? record.recipe_id : "";
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? new Date(`${weekStart}T00:00:00.000Z`) : null;
  if (
    Object.keys(record).some((key) => key !== "week_start" && key !== "recipe_id")
    || !parsedDate
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== weekStart
    || parsedDate.getUTCDay() !== 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipeId)
  ) {
    return NextResponse.json({ error: "Choose an existing Cook Together recipe and a Monday week start." }, { status: 400 });
  }

  try {
    const { data, error } = await getAdminSupabase()
      .rpc("admin_set_free_weekly_recipe", { p_week_start: weekStart, p_recipe_id: recipeId });
    if (error) {
      if (error.code === "22023") {
        return NextResponse.json({ error: "Choose an existing Cook Together recipe and a current or future Monday." }, { status: 400 });
      }
      throw error;
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("[admin weekly recipe POST]", error);
    return NextResponse.json({ error: "This weekly Cook Together recipe could not be scheduled." }, { status: 500 });
  }
}
