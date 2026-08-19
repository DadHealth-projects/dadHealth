"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SitePageShell from "@/components/SitePageShell";
import SiteFooter from "@/components/SiteFooter";
import LimeButton from "@/components/LimeButton";
import { useProStatus } from "@/components/ProProvider";
import { IMAGES } from "@/lib/images";
import { useAuth } from "@/contexts/AuthContext";
import { useFitness } from "@/hooks/useFitness";
import { DAD_STRENGTH_MOVES } from "@/lib/dadStrengthProgram";
import { trackEvent } from "@/lib/analytics";
import { supabase } from "@/utils/supabaseClient";
import type { Workout, WorkoutEquipment, WorkoutExercise, WorkoutFocus } from "@/types/database";
import TDEECalculator from "@/components/fitness/TDEECalculator";

const timerGhostBtn =
  "bg-transparent border py-2.5 px-4 font-heading font-bold text-xs tracking-wider uppercase transition-colors";
const timerGhostBtnMuted = `${timerGhostBtn} text-foreground/40 border-foreground/25`;
const timerGhostBtnActive = `${timerGhostBtn} text-foreground border-foreground/25 hover:border-primary hover:text-primary cursor-pointer`;

const SAMPLE_MEAL_PLAN = [
  {
    day: "Day 1",
    meals: {
      breakfast: {
        name: "Greek yoghurt parfait",
        ingredients: ["Greek yoghurt", "Blueberries", "Granola", "Honey"],
        macros: { protein: 24, carbs: 38, fat: 10 },
        prep_time: "5 min",
      },
      lunch: {
        name: "Chicken grain bowl",
        ingredients: ["Grilled chicken breast", "Brown rice", "Spinach", "Cherry tomatoes"],
        macros: { protein: 32, carbs: 45, fat: 12 },
        prep_time: "20 min",
      },
      dinner: {
        name: "Turkey mince tacos",
        ingredients: ["Turkey mince", "Corn tortillas", "Avocado", "Lettuce"],
        macros: { protein: 30, carbs: 34, fat: 14 },
        prep_time: "25 min",
      },
      snack: {
        name: "Apple & nut butter",
        ingredients: ["Apple", "Almond butter"],
        macros: { protein: 6, carbs: 30, fat: 12 },
        prep_time: "2 min",
      },
    },
  },
  {
    day: "Day 2",
    meals: {
      breakfast: {
        name: "Oatmeal with berries",
        ingredients: ["Rolled oats", "Almond milk", "Mixed berries", "Walnuts"],
        macros: { protein: 18, carbs: 55, fat: 14 },
        prep_time: "10 min",
      },
      lunch: {
        name: "Tuna salad wrap",
        ingredients: ["Tuna", "Wholemeal wrap", "Cucumber", "Greek yoghurt"],
        macros: { protein: 28, carbs: 32, fat: 11 },
        prep_time: "10 min",
      },
      dinner: {
        name: "Beef stir fry",
        ingredients: ["Lean beef", "Broccoli", "Pepper", "Soy sauce"],
        macros: { protein: 35, carbs: 40, fat: 15 },
        prep_time: "20 min",
      },
      snack: {
        name: "Cottage cheese & pineapple",
        ingredients: ["Cottage cheese", "Pineapple chunks"],
        macros: { protein: 16, carbs: 18, fat: 3 },
        prep_time: "2 min",
      },
    },
  },
  {
    day: "Day 3",
    meals: {
      breakfast: {
        name: "Protein pancakes",
        ingredients: ["Protein powder", "Eggs", "Banana", "Maple syrup"],
        macros: { protein: 28, carbs: 42, fat: 8 },
        prep_time: "15 min",
      },
      lunch: {
        name: "Chicken salad",
        ingredients: ["Chicken breast", "Mixed greens", "Avocado", "Cherry tomatoes"],
        macros: { protein: 30, carbs: 18, fat: 16 },
        prep_time: "10 min",
      },
      dinner: {
        name: "Salmon with veggies",
        ingredients: ["Salmon fillet", "Asparagus", "Quinoa", "Lemon"],
        macros: { protein: 33, carbs: 38, fat: 18 },
        prep_time: "25 min",
      },
      snack: {
        name: "Trail mix",
        ingredients: ["Mixed nuts", "Dried cranberries"],
        macros: { protein: 8, carbs: 20, fat: 14 },
        prep_time: "1 min",
      },
    },
  },
  {
    day: "Day 4",
    meals: {
      breakfast: {
        name: "Scrambled eggs & toast",
        ingredients: ["Eggs", "Wholemeal bread", "Spinach"],
        macros: { protein: 22, carbs: 30, fat: 14 },
        prep_time: "10 min",
      },
      lunch: {
        name: "Turkey quinoa bowl",
        ingredients: ["Turkey mince", "Quinoa", "Kale", "Carrots"],
        macros: { protein: 34, carbs: 42, fat: 13 },
        prep_time: "20 min",
      },
      dinner: {
        name: "Prawn pasta",
        ingredients: ["Prawns", "Wholewheat pasta", "Garlic", "Courgette"],
        macros: { protein: 28, carbs: 45, fat: 12 },
        prep_time: "20 min",
      },
      snack: {
        name: "Greek yoghurt with almonds",
        ingredients: ["Greek yoghurt", "Almonds", "Honey"],
        macros: { protein: 18, carbs: 24, fat: 10 },
        prep_time: "3 min",
      },
    },
  },
  {
    day: "Day 5",
    meals: {
      breakfast: {
        name: "Smoothie bowl",
        ingredients: ["Frozen berries", "Spinach", "Protein powder", "Chia seeds"],
        macros: { protein: 26, carbs: 40, fat: 10 },
        prep_time: "5 min",
      },
      lunch: {
        name: "Chicken burrito bowl",
        ingredients: ["Chicken", "Brown rice", "Black beans", "Salsa"],
        macros: { protein: 32, carbs: 46, fat: 12 },
        prep_time: "15 min",
      },
      dinner: {
        name: "Beef & veggie skillet",
        ingredients: ["Beef mince", "Courgette", "Pepper", "Onion"],
        macros: { protein: 31, carbs: 28, fat: 14 },
        prep_time: "25 min",
      },
      snack: {
        name: "Hummus & carrots",
        ingredients: ["Hummus", "Carrot sticks"],
        macros: { protein: 7, carbs: 18, fat: 8 },
        prep_time: "2 min",
      },
    },
  },
];

const SAMPLE_GROCERY_LIST = [
  { category: "Produce", items: ["Blueberries", "Bananas", "Spinach", "Cherry tomatoes", "Avocado", "Broccoli", "Pepper", "Cucumber", "Lettuce", "Asparagus", "Courgette", "Carrots", "Onion", "Lemon"] },
  { category: "Protein", items: ["Greek yoghurt", "Chicken breast", "Turkey mince", "Tuna", "Lean beef", "Salmon", "Eggs", "Cottage cheese", "Prawns", "Protein powder"] },
  { category: "Grains", items: ["Granola", "Brown rice", "Wholemeal wrap", "Corn tortillas", "Rolled oats", "Quinoa", "Wholewheat pasta", "Wholemeal bread"] },
  { category: "Pantry", items: ["Honey", "Soy sauce", "Olive oil", "Almond butter", "Maple syrup", "Mixed nuts", "Dried cranberries", "Chia seeds", "Hummus"] },
];

const renderMealPlan = (plan: any[]) => (
  <div className="grid gap-4">
    {plan.map((day, idx) => (
      <div key={`${day.day ?? idx}-${idx}`} className="rounded-3xl border border-border bg-background p-4">
        <div className="font-heading text-[11px] font-bold uppercase tracking-[0.38em] text-primary mb-3">
          {day.day ?? `Day ${idx + 1}`}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(day.meals || {}).map(([mealType, meal]: any) => (
            <div key={mealType} className="rounded-3xl bg-card p-3 border border-border">
              <div className="font-bold text-sm text-foreground uppercase tracking-[0.28em] mb-2">{mealType}</div>
              <div className="font-semibold text-sm text-foreground">{meal?.name ?? "—"}</div>
              <div className="text-[11px] text-muted-foreground mt-2">Prep: {meal?.prep_time ?? "—"}</div>
              <div className="text-[11px] text-muted-foreground mt-2">
                {meal?.ingredients?.join(", ") ?? "Ingredients not available"}
              </div>
              {meal?.macros && (
                <div className="text-[11px] text-muted-foreground mt-2">
                  {Object.entries(meal.macros).map(([key, value]) => (
                    <span key={key} className="inline-block mr-2">
                      {key}: {String(value)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const formatGroceryList = (list: any) => {
  if (!Array.isArray(list)) return [];
  if (list.length === 0) return [];
  if (typeof list[0] === "string") {
    return [{ category: "Shopping", items: list }];
  }
  return list;
};

const EQUIPMENT_LABEL: Record<WorkoutEquipment, string> = {
  none: "None",
  dumbbells: "Dumbbells",
  full_gym: "Full gym",
};

const FOCUS_LABEL: Record<WorkoutFocus, string> = {
  full_body: "Full body",
  upper: "Upper body",
  lower: "Lower body",
  core: "Core",
};

type DietaryPreference = "none" | "vegetarian" | "vegan" | "glutenFree" | "dairyFree";

type GeneratedMealPlanResponse = {
  plan?: unknown;
  grocery_list?: unknown;
};

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DIETARY_PREFERENCE_LABEL: Record<DietaryPreference, string> = {
  none: "No strict diet",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  glutenFree: "Gluten-free",
  dairyFree: "Dairy-free",
};

const mapExerciseToMove = (exercise: WorkoutExercise) => ({
  title: exercise.name,
  detail: `${exercise.sets} sets · ${exercise.reps_or_duration} · Rest ${exercise.rest_period}`,
  tag: exercise.muscle_group,
});

const FitnessPage = () => {
  const { user, openAuthModal } = useAuth();
  const { isPro, showPaywall } = useProStatus();
  const { workouts, bodyMetrics, activeMealPlan, loading: mealsLoading, saveWorkout } = useFitness(user?.id);
  const queryClient = useQueryClient();
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [durationMins, setDurationMins] = useState<10 | 20 | 30 | 45>(20);
  const [equipment, setEquipment] = useState<WorkoutEquipment>("none");
  const [focus, setFocus] = useState<WorkoutFocus>("full_body");

  const workoutsQuery = useQuery({
    queryKey: ["workouts-library", user?.id, isPro],
    queryFn: async () => {
      const base = supabase.from("workouts").select("*").eq("source", "admin").order("created_at", { ascending: false }).limit(8);
      const userGenerated = user?.id
        ? supabase
            .from("workouts")
            .select("*")
            .eq("user_id", user.id)
            .eq("source", "ai_generated")
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as { data: any[]; error: null });
      const [adminRes, userRes] = await Promise.all([base, userGenerated]);
      if (adminRes.error) throw adminRes.error;
      if ((userRes as any).error) throw (userRes as any).error;
      const adminRows = (adminRes.data ?? []) as Workout[];
      const userRows = ((userRes as any).data ?? []) as Workout[];
      return isPro ? [...userRows, ...adminRows] : adminRows;
    },
    refetchOnWindowFocus: false,
  });

  const completeGeneratedWorkout = useMutation({
    mutationFn: async (payload: { workoutId: string; durationActualSeconds: number }) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await supabase.from("workout_completions").insert({
        user_id: user.id,
        workout_id: payload.workoutId,
        duration_actual_seconds: payload.durationActualSeconds,
      });
      if (error) throw error;
    },
  });

  const generateWorkout = useMutation<Workout, Error, { durationMins: number; equipment: WorkoutEquipment; focus: WorkoutFocus }>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Unable to generate workout.");
      return data as Workout;
    },
    onSuccess: async (workout) => {
      await queryClient.invalidateQueries({ queryKey: ["workouts-library", user?.id, isPro] });
      setSelectedWorkoutId(workout.id);
    },
  });

  const [calorieTarget, setCalorieTarget] = useState("2200");
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>("none");
  const [preferences, setPreferences] = useState("High-protein, no fish");
  const [mealsPerDay, setMealsPerDay] = useState<number | "">(4);
  const [adults, setAdults] = useState<number | "">(1);

  const generateMealPlan = useMutation<GeneratedMealPlanResponse, Error, {
    calorieTarget: number;
    dietaryPreference: DietaryPreference;
    preferences: string;
    mealsPerDay: number;
    adults: number;
  }>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/generate-meal-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as GeneratedMealPlanResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data?.error ?? "Unable to generate meal plan.");
      }
      await queryClient.invalidateQueries({ queryKey: ["fitness", user?.id] });
      return data;
    },
  });

  const [timerSec, setTimerSec] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [currentExerciseIdx, setCurrentExerciseIdx] = useState(0);

  useEffect(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("dadHealth_workout_timer") : null;
    if (stored) {
      const { sec, date } = JSON.parse(stored);
      if (date === new Date().toISOString().slice(0, 10)) setTimerSec(sec);
    }
  }, []);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setTimerSec((s) => {
        const next = s + 1;
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("dadHealth_workout_timer", JSON.stringify({
            sec: next,
            date: new Date().toISOString().slice(0, 10),
          }));
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  useEffect(() => {
    setCurrentExerciseIdx(0);
  }, [selectedWorkoutId, workoutsQuery.dataUpdatedAt, generateWorkout.data?.id]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const monthWorkouts = workouts.filter((w: { performed_at: string }) => {
    const d = new Date(w.performed_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const weightMetrics = bodyMetrics.filter((m: { metric_type: string }) => m.metric_type === "weight");
  const latestWeight = weightMetrics[0];
  const prevWeight = weightMetrics[1];

  const bestRunMetric = bodyMetrics.find(
    (m: { metric_type: string }) => m.metric_type === "best_run_km" || m.metric_type === "best_run",
  );
  const bestRunDisplay =
    user &&
    bestRunMetric != null &&
    typeof bestRunMetric.value === "number" &&
    Number.isFinite(bestRunMetric.value)
      ? `${Number.isInteger(bestRunMetric.value) ? bestRunMetric.value : Number(bestRunMetric.value).toFixed(1)}km`
      : "—";

  const todayKey = localDateKey(new Date());
  const latestStepsMetric = bodyMetrics.find((m: { metric_type: string }) => m.metric_type === "steps");
  const latestActiveMinsMetric = bodyMetrics.find(
    (m: { metric_type: string; recorded_at: string }) =>
      m.metric_type === "active_mins" && m.recorded_at.slice(0, 10) === todayKey,
  );
  const latestStepsDisplay =
    user && latestStepsMetric?.value != null
      ? Number(latestStepsMetric.value).toLocaleString()
      : "â€”";
  const wearableActiveDisplay =
    user && latestActiveMinsMetric?.value != null
      ? `${Math.round(Number(latestActiveMinsMetric.value))} min`
      : null;

  const progressStats = [
    { value: user ? String(monthWorkouts) : "—", label: "WORKOUTS" },
    {
      value: user && prevWeight && latestWeight ? `${prevWeight.value}→${latestWeight.value}kg` : "—",
      label: "WEIGHT",
    },
    { value: latestStepsDisplay, label: "STEPS" },
    { value: wearableActiveDisplay ?? (timerSec > 0 ? formatTime(timerSec) : "0 min"), label: "ACTIVE TODAY" },
  ];

  const planData = generateMealPlan.data?.plan ?? activeMealPlan?.plan ?? null;
  const groceryListData = generateMealPlan.data?.grocery_list ?? activeMealPlan?.grocery_list ?? [];
  const grocerySections = formatGroceryList(groceryListData);
  const hasSavedPlan = Boolean(generateMealPlan.data?.plan ?? activeMealPlan?.plan);
  const planError = generateMealPlan.error?.message;
  const planLoading = generateMealPlan.status === "pending" || (mealsLoading && !planData);

  const libraryWorkouts = (workoutsQuery.data ?? []) as Workout[];
  const selectedWorkout =
    libraryWorkouts.find((w) => w.id === selectedWorkoutId) ??
    generateWorkout.data ??
    libraryWorkouts[0] ??
    null;
  const todaysMoves = selectedWorkout?.exercises?.length
    ? selectedWorkout.exercises.map(mapExerciseToMove)
    : DAD_STRENGTH_MOVES;
  const latestLoggedAt = [workouts[0]?.performed_at, bodyMetrics[0]?.recorded_at]
    .filter((value): value is string => Boolean(value))
    .reduce<string | null>((latest, value) => {
      if (!latest) return value;
      return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
    }, null);
  const currentMove = todaysMoves[currentExerciseIdx] ?? todaysMoves[0];

  const handleGenerateMealPlan = () => {
    if (!user) {
      openAuthModal();
      return;
    }
    if (!isPro) {
      showPaywall("Meal planner");
      return;
    }
    generateMealPlan.mutate({
      calorieTarget: Number(calorieTarget),
      dietaryPreference,
      preferences: preferences.trim(),
      mealsPerDay: Number(mealsPerDay || 1),
      adults: Number(adults || 1),
    });
  };

  const handleCompleteWorkout = () => {
    if (!user) {
      openAuthModal();
      return;
    }
    const totalMin = Math.max(1, Math.ceil(timerSec / 60));
    trackEvent("workout_completed", {
      workout_name: currentMove?.title ?? "Dad Strength",
      duration_minutes: totalMin,
      workout_type: currentMove?.tag ?? "DAD_STRENGTH",
      exercise_index: currentExerciseIdx + 1,
    });
    saveWorkout.mutate({
      exercise_name: currentMove?.title ?? "Dad Strength",
      duration_minutes: totalMin,
      calories: undefined,
    });
    if (selectedWorkout?.id) {
      completeGeneratedWorkout.mutate({
        workoutId: selectedWorkout.id,
        durationActualSeconds: timerSec,
      });
    }
  };

  const handleGenerateAiWorkout = () => {
    if (!user) {
      openAuthModal();
      return;
    }
    if (!isPro) {
      showPaywall("AI workout generator");
      return;
    }
    generateWorkout.mutate({ durationMins, equipment, focus });
  };

  const canUseNextExercise = Boolean(user && isPro);

  const handleNextExercise = () => {
    if (!user) {
      openAuthModal();
      return;
    }
    if (!isPro) {
      showPaywall("Step-by-step exercises");
      return;
    }
    if (todaysMoves.length === 0) return;
    setCurrentExerciseIdx((i) => {
      const nextIdx = (i + 1) % todaysMoves.length;
      const nextMove = todaysMoves[nextIdx];
      trackEvent("exercise_progressed", {
        exercise_name: nextMove?.title,
        exercise_index: nextIdx + 1,
      });
      return nextIdx;
    });
  };

  const handleToggleTimer = () => {
    if (!user) {
      openAuthModal();
      return;
    }
    if (!timerRunning) {
      trackEvent("workout_started", {
        workout_name: currentMove?.title ?? "Dad Strength",
        workout_type: currentMove?.tag ?? "DAD_STRENGTH",
        planned_moves: todaysMoves.length,
      });
    }
    setTimerRunning((running) => !running);
  };

  const handleStartSelectedWorkout = () => {
    if (!user) {
      openAuthModal();
      return;
    }
    if (!timerRunning) {
      trackEvent("workout_started", {
        workout_name: selectedWorkout?.title ?? currentMove?.title ?? "Dad Strength",
        workout_type: selectedWorkout?.focus ?? currentMove?.tag ?? "DAD_STRENGTH",
        planned_moves: todaysMoves.length,
      });
      setTimerRunning(true);
    }
  };

  return (
    <SitePageShell>
      {/* Hero */}
      <section className="relative w-full min-w-0 h-[320px] lg:h-[400px]">
        <img src={IMAGES.workout} alt="Workout" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-background/60" />
        <div className="relative z-10 flex flex-col justify-end h-full max-w-[1400px] mx-auto px-5 lg:px-8 pb-8">
          <span className="section-label text-primary mb-1">TODAY'S WORKOUT</span>
          <h1 className="font-heading text-[42px] lg:text-[56px] font-extrabold text-foreground uppercase leading-none tracking-wide">
            FITNESS AND NUTRITION
          </h1>
          <p className="text-sm text-foreground/50 mt-2">
            {todaysMoves.length} moves · workout + meal planner hub
            {latestLoggedAt
              ? ` · Last logged ${latestLoggedAt.slice(0, 10)}`
              : ""}
          </p>
        </div>
      </section>

      {/* Timer */}
      <section className="bg-background">
        <div className="max-w-[1400px] mx-auto px-5 lg:px-8 py-6 flex items-center gap-6">
          <div className="flex-1">
            <div className="font-heading text-[52px] font-extrabold text-foreground leading-none tracking-wide">{formatTime(timerSec)}</div>
            <div className="font-heading text-[10px] font-bold tracking-wider uppercase text-muted-foreground mt-1">
              WORKOUT TIMER · {todaysMoves.length} MOVES
            </div>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <LimeButton small onClick={handleToggleTimer}>
              {timerRunning ? "PAUSE" : "START"} →
            </LimeButton>
            <button
              type="button"
              onClick={handleNextExercise}
              title={
                canUseNextExercise
                  ? "Go to the next move in today's list"
                  : !user
                    ? "Sign in to use step-by-step"
                    : "Upgrade to Pro for step-by-step"
              }
              className={
                canUseNextExercise
                  ? timerGhostBtnActive
                  : `${timerGhostBtnMuted} cursor-pointer hover:border-foreground/40`
              }
            >
              NEXT EXERCISE
            </button>
            <button
              type="button"
              onClick={handleCompleteWorkout}
              disabled={!user || saveWorkout.isPending}
              className={
                !user || saveWorkout.isPending
                  ? `${timerGhostBtnMuted} cursor-not-allowed`
                  : timerGhostBtnActive
              }
            >
              {saveWorkout.isPending ? "..." : "LOG SESSION →"}
            </button>
          </div>
        </div>
      </section>

      {/* Content grid */}
      <div className="w-full px-0">
        <div className="bg-card overflow-hidden w-full">
          <div className="grid w-full min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-0">
            {/* Exercise list */}
            <div className="p-5 lg:p-8 min-w-0">
              <span className="section-label !p-0 mb-4 block">TODAY'S MOVES</span>
              {todaysMoves.map((move, i) => (
                <div
                  key={`${move.title}-${i}`}
                  className={`flex items-center gap-3 py-3 border-b border-border last:border-b-0 rounded-sm transition-colors ${
                    canUseNextExercise && currentExerciseIdx === i
                      ? "bg-primary/[0.08] ring-1 ring-primary/25 -mx-1 px-1"
                      : ""
                  }`}
                >
                  <div className="w-7 h-7 bg-primary/10 flex items-center justify-center font-heading font-extrabold text-xs text-primary shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-heading text-sm font-bold text-foreground tracking-wide">{move.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{move.detail}</div>
                  </div>
                  <span className="tag-pill shrink-0">{move.tag}</span>
                </div>
              ))}
            </div>

            {/* Vertical divider */}
            <div className="hidden lg:block w-px bg-border rounded-full self-stretch shrink-0 min-h-[200px]" />

            {/* Right side */}
            <div className="p-5 lg:p-8 min-w-0">
              <span className="section-label !p-0 mb-4 block">PROGRESS THIS MONTH</span>
              <div className="grid grid-cols-2 gap-3 mb-8">
                {progressStats.map((stat) => (
                  <div key={stat.label} className="bg-card border border-border rounded-lg p-3.5">
                    <div className="font-heading text-xl font-extrabold text-primary leading-none">{stat.value}</div>
                    <div className="text-[10px] text-muted-foreground mt-1.5 uppercase tracking-wide">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-border bg-background p-4 lg:p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-heading text-xs font-extrabold uppercase tracking-[0.25em] text-primary">
                      Workout Generator
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Build a custom session by time, equipment and focus.
                    </p>
                  </div>
                  {isPro ? (
                    <span className="tag-pill shrink-0">PRO</span>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="tag-pill">FREE</span>
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <label className="text-[11px] text-muted-foreground">
                    Duration
                    <select
                      value={durationMins}
                      onChange={(e) => setDurationMins(Number(e.target.value) as 10 | 20 | 30 | 45)}
                      className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    >
                      <option value={10}>10 min</option>
                      <option value={20}>20 min</option>
                      <option value={30}>30 min</option>
                      <option value={45}>45 min</option>
                    </select>
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Equipment
                    <select
                      value={equipment}
                      onChange={(e) => setEquipment(e.target.value as WorkoutEquipment)}
                      className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    >
                      <option value="none">None</option>
                      <option value="dumbbells">Dumbbells</option>
                      <option value="full_gym">Full gym</option>
                    </select>
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Focus
                    <select
                      value={focus}
                      onChange={(e) => setFocus(e.target.value as WorkoutFocus)}
                      className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    >
                      <option value="full_body">Full body</option>
                      <option value="upper">Upper body</option>
                      <option value="lower">Lower body</option>
                      <option value="core">Core</option>
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <LimeButton onClick={handleGenerateAiWorkout} disabled={isPro && generateWorkout.isPending}>
                    {isPro ? (generateWorkout.isPending ? "GENERATING..." : "GENERATE →") : "GENERATE →"}
                  </LimeButton>
                  <button type="button" onClick={handleStartSelectedWorkout} className={timerGhostBtnActive}>
                    START
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                      {isPro ? "All available workouts" : "Free workouts (8 max)"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{libraryWorkouts.length} shown</p>
                  </div>
                  <div className="grid gap-2 max-h-56 overflow-y-auto pr-1">
                    {libraryWorkouts.map((workout) => {
                      const active = selectedWorkout?.id === workout.id;
                      return (
                        <button
                          key={workout.id}
                          type="button"
                          onClick={() => setSelectedWorkoutId(workout.id)}
                          className={`text-left rounded-xl border p-2.5 transition-colors ${
                            active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                          }`}
                        >
                          <div className="font-heading text-[11px] font-extrabold uppercase text-foreground">{workout.title}</div>
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {workout.duration_mins} min · {EQUIPMENT_LABEL[workout.equipment]} · {FOCUS_LABEL[workout.focus]}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full px-0 mt-8">
        <div className="bg-card overflow-hidden w-full">
          <div className="p-5 lg:p-8 min-w-0">
            <span className="section-label !p-0 mb-4 block">MEAL PLANNER</span>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="grid grid-cols-1 gap-6">
                {/* Planner */}
                <div className="bg-background p-5 lg:p-6 rounded-2xl border border-border">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                      <div className="font-heading text-lg font-extrabold text-foreground uppercase tracking-wide">
                        PERSONALISED MEAL PLAN
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-2 max-w-2xl">
                        Set your target and preferences. Generate a 5-day plan with recipes, macros and a shopping list.
                      </p>
                    </div>
                    <span className="tag-pill shrink-0">{isPro ? "PRO" : "PREVIEW"}</span>
                  </div>

                  {!isPro ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-border bg-background/40 p-4">
                        <p className="text-sm text-foreground font-semibold">Free preview</p>
                        <p className="text-sm text-muted-foreground mt-2">
                          Upgrade to Dad Health Pro to generate your personalised plan. Here&apos;s a sample plan so you can see the format.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                          <span className="text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                            Calorie target
                          </span>
                          <input
                            type="number"
                            value={calorieTarget}
                            onChange={(event) => setCalorieTarget(event.target.value)}
                            className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
                          />
                        </label>
                        <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                          <span className="text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                            Meals per day
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={6}
                            value={mealsPerDay}
                            onChange={(event) => {
  const value = event.target.value;
  setMealsPerDay(value === "" ? "" : Number(value));
}}
                            className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
                          />
                        </label>
                        <label className="flex flex-col gap-2 text-sm text-muted-foreground sm:col-span-2">
                          <span className="text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                            Strict dietary requirement
                          </span>
                          <select
                            value={dietaryPreference}
                            onChange={(event) => setDietaryPreference(event.target.value as DietaryPreference)}
                            className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
                          >
                            {(Object.keys(DIETARY_PREFERENCE_LABEL) as DietaryPreference[]).map((option) => (
                              <option key={option} value={option}>
                                {DIETARY_PREFERENCE_LABEL[option]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-2 text-sm text-muted-foreground sm:col-span-2">
                          <span className="text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                            Other preferences
                          </span>
                          <input
                            type="text"
                            value={preferences}
                            onChange={(event) => setPreferences(event.target.value)}
                            placeholder="e.g. high-protein, no fish"
                            className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
                          />
                        </label>
                        <label className="flex flex-col gap-2 text-sm text-muted-foreground sm:col-span-2">
                          <span className="text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                            Adults
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={adults}
                            onChange={(event) => {
  const value = event.target.value;
  setAdults(value === "" ? "" : Number(value));
}}
                            className="w-28 rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
                          />
                        </label>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm text-muted-foreground">
                          {hasSavedPlan ? "Last saved meal plan ready." : "No plan generated yet."}
                        </div>
                        <LimeButton onClick={handleGenerateMealPlan} disabled={planLoading}>
                          {planLoading ? "GENERATING..." : planData ? "REGENERATE MEAL PLAN →" : "GENERATE MEAL PLAN →"}
                        </LimeButton>
                      </div>

                      {planError && (
                        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700">
                          {planError}
                        </div>
                      )}

                      {!planData && (
                        <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                          Enter your details and tap generate to create a personalised 5-day meal plan.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Grocery / Tips */}
                <aside className="bg-background p-5 lg:p-6 rounded-2xl border border-border">
                  <div className="font-heading text-[11px] font-bold uppercase tracking-[0.35em] text-primary mb-4">
                    {grocerySections.length > 0 && planData ? "SHOPPING LIST" : "HOW IT WORKS"}
                  </div>

                  {grocerySections.length > 0 && planData ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {grocerySections.map((section: any) => (
                          <div key={section.category} className="rounded-lg border border-border bg-background/40 p-4">
                            <div className="font-heading text-xs font-extrabold text-foreground uppercase tracking-wide mb-2">
                              {section.category}
                            </div>
                            <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                              {section.items.map((item: string) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-lg border border-border bg-background/40 p-4">
                        <div className="font-heading text-sm font-extrabold text-foreground uppercase tracking-wide">
                          Built for real life
                        </div>
                        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                          Simple meals, clear prep time, and a shopping list you can actually use - no "dashboard" vibes.
                        </p>
                      </div>

                      <div className="rounded-lg border border-border bg-background/40 p-4">
                        <div className="font-heading text-sm font-extrabold text-foreground uppercase tracking-wide">
                          Preview shopping list
                        </div>
                        <div className="grid gap-3 mt-3">
                          {SAMPLE_GROCERY_LIST.slice(0, 3).map((section) => (
                            <div key={section.category}>
                              <div className="text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                                {section.category}
                              </div>
                              <div className="text-sm text-muted-foreground mt-1">
                                {section.items.slice(0, 6).join(", ")}
                                {section.items.length > 6 ? "…" : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border bg-background/40 p-4">
                        <div className="text-[11px] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                          Tip
                        </div>
                        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                          Start with “high protein” and one hard rule (e.g. “no fish”). The more specific, the better the plan.
                        </p>
                      </div>
                    </div>
                  )}
                </aside>

                {!isPro && (
                  <div className="space-y-5">
                    <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="font-heading text-sm font-extrabold text-foreground uppercase tracking-wide">
                            Unlock tailored plans
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Get personalised macros, recipes, and a shopping list you can use in your local supermarket.
                          </p>
                        </div>
                        <LimeButton
                          className="w-full sm:w-auto shrink-0"
                          onClick={() => {
                            if (!user) {
                              openAuthModal();
                            } else {
                              showPaywall("Meal planner");
                            }
                          }}
                        >
                          Upgrade to Pro →
                        </LimeButton>
                      </div>
                    </div>
                  </div>
                )}

                {isPro && planData && (
                  <div>
                    {renderMealPlan(planData)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── TDEE Calculator ────────────────────────────────────────────── */}
      <div id="tdee" className="w-full px-0 mt-8">
        <div className="bg-card overflow-hidden w-full">
          <div className="p-5 lg:p-8 min-w-0">
            <span className="section-label !p-0 mb-4 block">TDEE CALCULATOR</span>
            <TDEECalculator />
          </div>
        </div>
      </div>

      <SiteFooter />
    </SitePageShell>
  );
};

export default FitnessPage;
