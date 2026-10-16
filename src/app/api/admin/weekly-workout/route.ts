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

export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { data, error } = await getAdminSupabase()
      .from("free_weekly_workout_assignments")
      .select("week_start, workout_id, workouts(title)")
      .order("week_start", { ascending: false })
      .limit(52);
    if (error) throw error;

    return NextResponse.json((data ?? []).map((row) => {
      const joinedWorkout = Array.isArray(row.workouts) ? row.workouts[0] : row.workouts;
      return {
        week_start: row.week_start,
        workout_id: row.workout_id,
        workout_title: joinedWorkout?.title ?? "Unavailable workout",
      };
    }));
  } catch (error) {
    console.error("[admin weekly workout GET]", error);
    return NextResponse.json({ error: "Weekly workouts could not be loaded." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Weekly workout details are required." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Weekly workout details are required." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const weekStart = typeof record.week_start === "string" ? record.week_start : "";
  const workoutId = typeof record.workout_id === "string" ? record.workout_id : "";
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? new Date(`${weekStart}T00:00:00.000Z`) : null;
  if (
    Object.keys(record).some((key) => key !== "week_start" && key !== "workout_id")
    || !parsedDate
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== weekStart
    || parsedDate.getUTCDay() !== 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workoutId)
  ) {
    return NextResponse.json({ error: "Choose an existing Admin workout and a Monday week start." }, { status: 400 });
  }

  try {
    const { data, error } = await getAdminSupabase()
      .rpc("admin_set_free_weekly_workout", { p_week_start: weekStart, p_workout_id: workoutId });
    if (error) {
      if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("[admin weekly workout POST]", error);
    return NextResponse.json({ error: "This weekly workout could not be scheduled." }, { status: 500 });
  }
}
