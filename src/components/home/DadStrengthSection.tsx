"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import LimeButton from "@/components/LimeButton";
import { useAuth } from "@/contexts/AuthContext";
import { useFitness } from "@/hooks/useFitness";
import { useProStatus } from "@/components/ProProvider";
import { supabase } from "@/utils/supabaseClient";
import { DAD_STRENGTH_MOVES } from "@/lib/dadStrengthProgram";
import type { Workout, WorkoutExercise } from "@/types/database";

interface DadStrengthSectionProps {
  workoutImg: string;
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const mapExerciseToMove = (exercise: WorkoutExercise) => ({
  title: exercise.name,
  detail: `${exercise.sets} sets · ${exercise.reps_or_duration} · Rest ${exercise.rest_period}`,
  tag: exercise.muscle_group,
});

const DadStrengthSection = ({ workoutImg }: DadStrengthSectionProps) => {
  const { user } = useAuth();
  const { isPro } = useProStatus();
  const { workouts, bodyMetrics } = useFitness(user?.id);

  // Mirror the fitness page library query so the moves shown here are the
  // same real workout the user sees on /fitness, not the hardcoded mockup.
  const workoutsQuery = useQuery({
    queryKey: ["workouts-library", user?.id, isPro],
    queryFn: async () => {
      const base = supabase
        .from("workouts")
        .select("*")
        .eq("source", "admin")
        .order("created_at", { ascending: false })
        .limit(8);
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

  const libraryWorkouts = (workoutsQuery.data ?? []) as Workout[];
  const todaysWorkout = libraryWorkouts[0] ?? null;
  const todaysMoves = todaysWorkout?.exercises?.length
    ? todaysWorkout.exercises.map(mapExerciseToMove)
    : DAD_STRENGTH_MOVES;

  const monthWorkouts = workouts.filter((w: { performed_at: string }) => {
    const d = new Date(w.performed_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const weightMetrics = bodyMetrics.filter((m: { metric_type: string }) => m.metric_type === "weight");
  const latestWeight = weightMetrics[0];
  const prevWeight = weightMetrics[1];
  const weightDisplay = user && prevWeight && latestWeight
    ? `${prevWeight.value}→${latestWeight.value}kg`
    : user && latestWeight
      ? `${latestWeight.value}kg`
      : "—";

  // Wearable-synced metrics — same source the fitness page reads from.
  const todayKey = localDateKey(new Date());
  const latestStepsMetric = bodyMetrics.find((m: { metric_type: string }) => m.metric_type === "steps");
  const latestActiveMinsMetric = bodyMetrics.find(
    (m: { metric_type: string; recorded_at: string }) =>
      m.metric_type === "active_mins" && m.recorded_at.slice(0, 10) === todayKey,
  );
  const latestStepsDisplay =
    user && latestStepsMetric?.value != null
      ? Number(latestStepsMetric.value).toLocaleString()
      : "—";

  // Fall back to today's logged workout durations if no wearable active_mins yet.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayWorkouts = workouts.filter((w: { performed_at: string }) => {
    const d = new Date(w.performed_at);
    return d >= todayStart && d <= todayEnd;
  });
  const activeTodayMin = todayWorkouts.reduce(
    (sum: number, w: { duration_minutes?: number }) => sum + (w.duration_minutes ?? 0),
    0,
  );
  const wearableActiveDisplay =
    user && latestActiveMinsMetric?.value != null
      ? `${Math.round(Number(latestActiveMinsMetric.value))} min`
      : null;
  const activeDisplay = wearableActiveDisplay
    ?? (user && activeTodayMin > 0 ? `${activeTodayMin} min` : "—");

  const latestLoggedAt = [workouts[0]?.performed_at, bodyMetrics[0]?.recorded_at]
    .filter((value): value is string => Boolean(value))
    .reduce<string | null>((latest, value) => {
      if (!latest) return value;
      return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
    }, null);

  const progressStats = [
    { value: user ? String(monthWorkouts) : "—", label: "WORKOUTS" },
    { value: weightDisplay, label: "WEIGHT" },
    { value: latestStepsDisplay, label: "STEPS" },
    { value: activeDisplay, label: "ACTIVE TODAY" },
  ];

  return (
  <section className="bg-background pt-8 pb-16 lg:pb-20">
    {/* Hero banner */}
   <div className="relative w-full min-w-0 h-[400px] lg:h-[480px]">
    <img src={workoutImg} alt="Dad Strength Workout"
    className="absolute inset-0 w-full h-full object-cover object-center" />
      <div className="absolute inset-0 bg-background/60" />
      <div className="relative z-10 flex flex-col justify-end h-full max-w-[1400px] mx-auto px-5 lg:px-8 pb-8">
        <span className="section-label text-primary mb-1">TODAY'S WORKOUT</span>
        <h2 className="font-heading text-[42px] lg:text-[56px] font-extrabold text-foreground uppercase leading-none tracking-wide">
          {todaysWorkout?.title ?? "DAD STRENGTH"}
        </h2>
        <p className="text-sm text-foreground/50 mt-2">
          {todaysMoves.length} moves · full-body session
          {latestLoggedAt
            ? ` · Last logged ${latestLoggedAt.slice(0, 10)}`
            : ""}
        </p>
      </div>
    </div>

    <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-0">
      {/* Timer + Exercises */}
      <div className="px-5 lg:px-8 py-8">
        {/* Timer */}
        <div className="mb-6">
          <div className="font-heading text-[52px] font-extrabold text-foreground leading-none tracking-wide">00:00</div>
          <div className="font-heading text-[10px] font-bold tracking-wider uppercase text-muted-foreground mt-1">
            WORKOUT TIMER · {todaysMoves.length} MOVES
          </div>
          <div className="flex gap-3 mt-4">
            <Link href="/fitness">
              <LimeButton small>START →</LimeButton>
            </Link>
            <Link href="/fitness">
              <button className="bg-transparent text-foreground border border-foreground py-2 px-3.5 font-heading font-bold text-[11px] tracking-wider uppercase cursor-pointer hover:border-primary hover:text-primary transition-colors">
                NEXT EXERCISE
              </button>
            </Link>
          </div>
        </div>

        {/* Exercise list */}
        <span className="section-label !p-0 mb-4 block">TODAY&apos;S MOVES</span>
        {todaysMoves.map((move, i) => (
          <div key={`${move.title}-${i}`} className="flex items-center gap-3 py-3 border-b border-border last:border-b-0">
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

      {/* Progress */}
      <div className="px-5 lg:px-8 py-8 border-l border-border">
        <span className="section-label !p-0 mb-4 block">PROGRESS THIS MONTH</span>
        <div className="grid grid-cols-2 gap-3 mb-8">
          {progressStats.map((stat) => (
            <div key={stat.label} className="card-dark p-3.5">
              <div className="font-heading text-xl font-extrabold text-primary leading-none">{stat.value}</div>
              <div className="text-[10px] text-muted-foreground mt-1.5 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>
        <Link href="/fitness">
          <LimeButton>VIEW FULL FITNESS →</LimeButton>
        </Link>
      </div>
    </div>
  </section>
  );
};

export default DadStrengthSection;
