import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/utils/supabase/server";
import { isProfilePro } from "@/lib/stripe/subscription";
import type { WorkoutEquipment, WorkoutExercise, WorkoutFocus } from "@/types/database";

const VALID_DURATIONS = new Set([10, 20, 30, 45]);
const VALID_EQUIPMENT: WorkoutEquipment[] = ["none", "dumbbells", "full_gym"];
const VALID_FOCUS: WorkoutFocus[] = ["full_body", "upper", "lower", "core"];
const FREE_MONTHLY_GENERATIONS = 3;

type ClaimResult = {
  claim_id: string | null;
  outcome: "claimed" | "duplicate" | "in_progress" | "limit_reached";
  workout_id: string | null;
  used_count: number;
};

function errorResponse(code: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ code, error: message, requestId }, { status });
}

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
  const requestedId = req.headers.get("x-request-id")?.trim();
  const requestId = requestedId && /^[A-Za-z0-9._:-]{8,128}$/.test(requestedId)
    ? requestedId
    : crypto.randomUUID();
  let claimId: string | null = null;
  try {
    const body = (await req.json()) as {
      durationMins?: number;
      equipment?: WorkoutEquipment;
      focus?: WorkoutFocus;
    };

    if (!VALID_DURATIONS.has(Number(body.durationMins))) {
      return errorResponse("invalid_request", "Choose a valid workout duration.", 400, requestId);
    }
    if (!VALID_EQUIPMENT.includes(body.equipment as WorkoutEquipment)) {
      return errorResponse("invalid_request", "Choose valid workout equipment.", 400, requestId);
    }
    if (!VALID_FOCUS.includes(body.focus as WorkoutFocus)) {
      return errorResponse("invalid_request", "Choose a valid workout focus.", 400, requestId);
    }

    const durationMins = Number(body.durationMins);
    const equipment = body.equipment as WorkoutEquipment;
    const focus = body.focus as WorkoutFocus;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bearerToken = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const nativeSupabase = supabaseUrl && serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : null;
    const authSupabase = await createServerSupabaseClient();
    const authResult = bearerToken && nativeSupabase
      ? await nativeSupabase.auth.getUser(bearerToken)
      : await authSupabase.auth.getUser();
    const user = authResult.data.user;
    if (!user) {
      return errorResponse("session_expired", "Your session has expired.", 401, requestId);
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey || !supabaseUrl || !serviceRoleKey) {
      return errorResponse(
        "temporarily_unavailable",
        "Workout generation is temporarily unavailable.",
        503,
        requestId,
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: profile, error: profileError } = await admin
      .from("user_profile")
      .select("is_pro, subscription_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return errorResponse(
        "allowance_unavailable",
        "We couldn't check your workout allowance. Please try again.",
        503,
        requestId,
      );
    }

    const isPro = isProfilePro(profile as {
      is_pro?: boolean | string | number | null;
      subscription_status?: string | null;
    } | null);

    if (!isPro) {
      const { data: claim, error: claimError } = await admin
        .rpc("claim_ai_workout_generation", {
          p_user_id: user.id,
          p_request_key: requestId,
        })
        .maybeSingle<ClaimResult>();

      if (claimError || !claim) {
        return errorResponse(
          "allowance_unavailable",
          "We couldn't check your workout allowance. Please try again.",
          503,
          requestId,
        );
      }

      if (claim.outcome === "limit_reached") {
        return errorResponse(
          "free_limit_reached",
          `You have used your ${FREE_MONTHLY_GENERATIONS} free AI workouts this month.`,
          403,
          requestId,
        );
      }

      if (claim.outcome === "in_progress") {
        return errorResponse(
          "generation_in_progress",
          "This workout is still being created. Please wait a moment.",
          409,
          requestId,
        );
      }

      if (claim.outcome === "duplicate" && claim.workout_id) {
        const { data: existingWorkout } = await admin
          .from("workouts")
          .select("*")
          .eq("id", claim.workout_id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (existingWorkout) return NextResponse.json(existingWorkout);
      }

      claimId = claim.claim_id;
      if (!claimId) {
        return errorResponse(
          "allowance_unavailable",
          "We couldn't check your workout allowance. Please try again.",
          503,
          requestId,
        );
      }
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const prompt = `Generate a ${durationMins}-minute workout for a UK dad.
Equipment: ${equipment}
Focus area: ${focus}

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

    const title = toTitle(focus, durationMins, equipment);
    const workoutWrite = claimId
      ? await admin
          .rpc("complete_ai_workout_generation", {
            p_claim_id: claimId,
            p_title: title,
            p_duration_mins: durationMins,
            p_equipment: equipment,
            p_focus: focus,
            p_exercises: exercises,
          })
          .single()
      : await admin
          .from("workouts")
          .insert({
            user_id: user.id,
            title,
            duration_mins: durationMins,
            equipment,
            focus,
            exercises,
            source: "ai_generated",
          })
          .select()
          .single();

    const { data, error } = workoutWrite;

    if (error) throw error;
    claimId = null;
    console.info("[generate-workout] workout saved", {
      requestId,
      userId: user.id,
      workoutId: data.id,
      exerciseCount: exercises.length,
    });
    return NextResponse.json(data);
  } catch (error) {
    if (claimId) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceRoleKey) {
        await createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
          .rpc("fail_ai_workout_generation", { p_claim_id: claimId });
      }
    }
    console.error("[generate-workout] request failed", { requestId, error });
    return errorResponse(
      "generation_failed",
      "We couldn't create a workout right now.",
      500,
      requestId,
    );
  }
}

