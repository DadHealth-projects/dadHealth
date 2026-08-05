import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import { isProfilePro } from "@/lib/stripe/subscription";
import type { WorkoutEquipment, WorkoutExercise, WorkoutFocus } from "@/types/database";

const VALID_DURATIONS = new Set([10, 20, 30, 45]);
const VALID_EQUIPMENT: WorkoutEquipment[] = ["none", "dumbbells", "full_gym"];
const VALID_FOCUS: WorkoutFocus[] = ["full_body", "upper", "lower", "core"];

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function isValidExercise(ex: unknown): ex is WorkoutExercise {
  const row = ex as Record<string, unknown>;
  return (
    typeof row?.name === "string" &&
    typeof row?.sets === "number" &&
    typeof row?.reps_or_duration === "string" &&
    typeof row?.rest_period === "string" &&
    typeof row?.muscle_group === "string" &&
    typeof row?.beginner_modification === "string"
  );
}

function ensureWorkoutExercises(raw: unknown): WorkoutExercise[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Invalid exercise array");
  }
  const parsed = raw.filter(isValidExercise).map((ex) => ({
    name: ex.name.trim(),
    sets: Math.max(1, Math.round(ex.sets)),
    reps_or_duration: ex.reps_or_duration.trim(),
    rest_period: ex.rest_period.trim(),
    muscle_group: ex.muscle_group.trim(),
    beginner_modification: ex.beginner_modification.trim(),
  }));
  if (parsed.length === 0) {
    throw new Error("No valid exercises returned");
  }
  return parsed;
}

function toTitle(focus: WorkoutFocus, durationMins: number, equipment: WorkoutEquipment) {
  const focusLabel: Record<WorkoutFocus, string> = {
    full_body: "Full Body",
    upper: "Upper Body",
    lower: "Lower Body",
    core: "Core",
  };
  const equipmentLabel: Record<WorkoutEquipment, string> = {
    none: "No Equipment",
    dumbbells: "Dumbbells",
    full_gym: "Full Gym",
  };
  return `${focusLabel[focus]} · ${durationMins} min · ${equipmentLabel[equipment]}`;
}

export async function POST(req: Request) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = (await req.json()) as {
      durationMins?: number;
      equipment?: WorkoutEquipment;
      focus?: WorkoutFocus;
    };

    if (!VALID_DURATIONS.has(Number(body.durationMins))) {
      return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
    }
    if (!VALID_EQUIPMENT.includes(body.equipment as WorkoutEquipment)) {
      return NextResponse.json({ error: "Invalid equipment" }, { status: 400 });
    }
    if (!VALID_FOCUS.includes(body.focus as WorkoutFocus)) {
      return NextResponse.json({ error: "Invalid focus" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bearerToken = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const authSupabase = await createServerSupabaseClient();
    const nativeSupabase = supabaseUrl && serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : null;
    const authResult = bearerToken && nativeSupabase
      ? await nativeSupabase.auth.getUser(bearerToken)
      : await authSupabase.auth.getUser();
    const user = authResult.data.user;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    const profileClient = bearerToken && nativeSupabase ? nativeSupabase : authSupabase;
    const { data: profile } = await profileClient
      .from("user_profile")
      .select("is_pro, subscription_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!isProfilePro(profile as {
      is_pro?: boolean | string | number | null;
      subscription_status?: string | null;
    } | null)) {
      return NextResponse.json({ error: "Workout generator is a Pro feature" }, { status: 403 });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey || !supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Server configuration is incomplete" }, { status: 503 });
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const prompt = `Generate a ${body.durationMins}-minute workout for a UK dad.
Equipment: ${body.equipment}
Focus area: ${body.focus}

Return ONLY valid JSON in this exact shape:
[
  {
    "name": "Exercise name",
    "sets": 3,
    "reps_or_duration": "10 reps",
    "rest_period": "45 sec",
    "muscle_group": "legs",
    "beginner_modification": "bodyweight variation"
  }
]

Rules:
- 4 to 8 exercises
- realistic for the requested time and equipment
- safe progression and warm-up friendly ordering
- use British English wording only where language appears`;

    const ai = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      temperature: 0.7,
      system: "You are a helpful fitness coach that creates workout plans for busy UK dads. You understand the constraints of time, equipment, and common fitness goals for this audience.",
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = ai.content.find((block) => (block as { type?: string }).type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const parsed = parseJson(textBlock?.text ?? "[]");
    const exercises = ensureWorkoutExercises(parsed);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const title = toTitle(body.focus as WorkoutFocus, Number(body.durationMins), body.equipment as WorkoutEquipment);
    const { data, error } = await admin
      .from("workouts")
      .insert({
        user_id: user.id,
        title,
        duration_mins: Number(body.durationMins),
        equipment: body.equipment,
        focus: body.focus,
        exercises,
        source: "ai_generated",
      })
      .select()
      .single();

    if (error) throw error;
    console.info("[generate-workout] workout saved", {
      requestId,
      userId: user.id,
      workoutId: data.id,
      exerciseCount: exercises.length,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[generate-workout] request failed", { requestId, error });
    return NextResponse.json({ error: "Could not generate workout right now." }, { status: 500 });
  }
}

