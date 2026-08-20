"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/utils/supabaseClient";
import { trackEvent } from "@/lib/analytics";

async function updateStreak(supabaseClient: typeof supabase, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabaseClient
    .from("user_streaks")
    .select("streak_count, last_activity_date")
    .eq("user_id", userId)
    .maybeSingle();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  let newCount = 1;
  if (existing) {
    if (existing.last_activity_date === today) return null;
    if (existing.last_activity_date === yesterdayStr) {
      newCount = (existing.streak_count ?? 0) + 1;
    }
  }

  await supabaseClient
    .from("user_streaks")
    .upsert({ user_id: userId, streak_count: newCount, last_activity_date: today }, { onConflict: "user_id" });

  return newCount;
}

async function fetchDashboard(userId: string) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
  const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [dashboardRes, scoreRes, moodRes, workoutsRes, journalRes, milestonesRes, milestonesListRes, challengeRes, dadDatesRes, profileRes, bodyRes, todayWorkoutsRes, remindersRes, circlesRes, bodyWeekRes, latestWorkoutRes, mealPlansRes, earnedBadgesRes] = await Promise.all([
    supabase.from("dashboard_view").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("dad_score_view").select("mind_score, body_score, bond_score").eq("user_id", userId).maybeSingle(),
    supabase
      .from("mood_logs")
      .select("date, mood_value")
      .eq("user_id", userId)
      .gte("date", sevenDaysAgo.toISOString().slice(0, 10))
      .order("date"),
    supabase
      .from("workout_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("performed_at", monthStart)
      .lte("performed_at", monthEnd),
    supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", monthStart)
      .lte("created_at", monthEnd + "T23:59:59"),
    supabase
      .from("milestones")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("date", monthStart)
      .lte("date", monthEndDate),
    supabase
      .from("milestones")
      .select("id, date, text, photo_url")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(8),
    supabase.from("weekly_challenges").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("dad_dates").select("*"),
    supabase.from("user_profile").select("display_name, goals").eq("user_id", userId).maybeSingle(),
    supabase
      .from("body_metrics")
      .select("value")
      .eq("user_id", userId)
      .eq("metric_type", "weight")
      .order("recorded_at", { ascending: false })
      .limit(2),
    supabase
      .from("workout_sessions")
      .select("duration_minutes")
      .eq("user_id", userId)
      .gte("performed_at", todayStart.toISOString())
      .lte("performed_at", todayEnd.toISOString()),
    supabase
      .from("reminders")
      .select("id, type, text, time")
      .eq("user_id", userId)
      .order("time", { ascending: true }),
    supabase
      .from("circles")
      .select("id, icon, name, members_count")
      .order("members_count", { ascending: false })
      .limit(6),
    supabase
      .from("workout_sessions")
      .select("performed_at, duration_minutes")
      .eq("user_id", userId)
      .gte("performed_at", sevenDaysAgo.toISOString()),
    supabase
      .from("workout_sessions")
      .select("exercise_name, duration_minutes, calories, performed_at")
      .eq("user_id", userId)
      .order("performed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("meal_plans")
      .select("id, plan, grocery_list, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("earned_badges")
      .select("badges(icon, name)")
      .eq("user_id", userId),
  ]);

  // Views may be missing in DB or blocked by RLS — fall back without failing the whole dashboard.
  const dashboard = dashboardRes.error ? null : dashboardRes.data;
  const profile = profileRes.data;
  const score = scoreRes.error ? null : scoreRes.data;
  const moodLogs = moodRes.data ?? [];
  const monthWorkouts = workoutsRes.count ?? 0;
  const journalCount = journalRes.count ?? 0;
  const dadDatesCount = milestonesRes.count ?? 0;
  const challenge = challengeRes.data;
  const dadDates = dadDatesRes.data ?? [];
  const reminders = remindersRes.error ? [] : (remindersRes.data ?? []);
  const circles = circlesRes.error ? [] : (circlesRes.data ?? []);
  const milestones = milestonesListRes.error ? [] : (milestonesListRes.data ?? []);
  const mealPlans = mealPlansRes.error ? [] : (mealPlansRes.data ?? []);
  const badges = earnedBadgesRes.error
    ? []
    : (earnedBadgesRes.data ?? [])
        .map((row: { badges?: { icon?: string; name?: string } | { icon?: string; name?: string }[] | null }) =>
          Array.isArray(row.badges) ? row.badges[0] : row.badges
        )
        .filter((badge): badge is { icon: string; name: string } => Boolean(badge?.icon && badge?.name));

  const mind = typeof score?.mind_score === "number" ? score.mind_score : null;
  const body = typeof score?.body_score === "number" ? score.body_score : null;
  const bond = typeof score?.bond_score === "number" ? score.bond_score : null;
  const hasAllScores =
    typeof mind === "number" &&
    typeof body === "number" &&
    typeof bond === "number";
  const totalScore = hasAllScores ? Math.round((mind + body + bond) / 3) : null;

  const weightRows = (bodyRes.data ?? []) as { value: number }[];
  const prevWeight = weightRows[1]?.value;
  const latestWeight = weightRows[0]?.value;
  const weightDisplay = prevWeight != null && latestWeight != null
    ? `${prevWeight}→${latestWeight}kg`
    : latestWeight != null
      ? `${latestWeight}kg`
      : null;

  const todayWorkouts = (todayWorkoutsRes.data ?? []) as { duration_minutes: number }[];
  const activeTodayMin = todayWorkouts.reduce((sum, w) => sum + (w.duration_minutes ?? 0), 0);
  const bodyWeekRows = (bodyWeekRes.error ? [] : (bodyWeekRes.data ?? [])) as { performed_at: string; duration_minutes: number | null }[];
  const bodyWeekKeys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const bodyTotals = new Map<string, number>();
  for (const row of bodyWeekRows) {
    const dayKey = row.performed_at?.slice(0, 10);
    if (!dayKey) continue;
    bodyTotals.set(dayKey, (bodyTotals.get(dayKey) ?? 0) + (row.duration_minutes ?? 0));
  }
  const bodyWeekSeries = bodyWeekKeys.map((k) => {
    const mins = bodyTotals.get(k) ?? 0;
    if (mins >= 40) return 4;
    if (mins >= 25) return 3;
    if (mins >= 10) return 2;
    if (mins > 0) return 1;
    return 0;
  });

  const latestWorkout = latestWorkoutRes.error ? null : latestWorkoutRes.data;
  const featuredWorkoutTitle =
    typeof latestWorkout?.exercise_name === "string" && latestWorkout.exercise_name.trim().length > 0
      ? latestWorkout.exercise_name.trim()
      : null;
  const featuredWorkoutMetaParts = [
    typeof latestWorkout?.duration_minutes === "number" ? `${latestWorkout.duration_minutes} min` : null,
    typeof latestWorkout?.calories === "number" ? `${latestWorkout.calories} kcal` : null,
    typeof latestWorkout?.performed_at === "string" ? `Logged ${latestWorkout.performed_at.slice(0, 10)}` : null,
  ].filter((part): part is string => Boolean(part));
  const featuredWorkoutMeta = featuredWorkoutMetaParts.length > 0 ? featuredWorkoutMetaParts.join(" · ") : null;

  return {
    ...(dashboard ?? {}),
    display_name: profile?.display_name,
    goals: Array.isArray(profile?.goals) ? profile.goals : [],
    mind_score: mind,
    body_score: body,
    bond_score: bond,
    total_score: totalScore,
    mood_logs: moodLogs,
    month_workouts: monthWorkouts,
    reportStats: {
      workouts: monthWorkouts,
      journal: journalCount,
      dadDates: dadDatesCount,
    },
    challenge,
    reminders,
    circles,
    milestones,
    dad_dates: dadDates,
    dadDates,
    date: new Date().toISOString().slice(0, 10),
    weightDisplay,
    activeTodayMin,
    body_week_series: bodyWeekSeries,
    featured_workout_title: featuredWorkoutTitle,
    featured_workout_meta: featuredWorkoutMeta,
    meal_plans: mealPlans,
    badges,
  };
}

async function fetchAppStats() {
  const { count: dadsCount, error } = await supabase
    .from("user_profile")
    .select("id", { count: "exact", head: true });
  return { dadsCount: error ? 0 : (dadsCount ?? 0) };
}

export function useDashboard(userId?: string) {
  const queryClient = useQueryClient();
  const date = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", userId],
    queryFn: () => fetchDashboard(userId!),
    enabled: !!userId,
  });

  const { data: appStats } = useQuery({
    queryKey: ["app_stats"],
    queryFn: fetchAppStats,
  });

  const checkIn = useMutation({
    mutationFn: async ({ mood_value, sleep_hours }: { mood_value: number; sleep_hours: number }) => {
      if (!userId) throw new Error("Not authenticated");
      const { data: existingSleep } = await supabase
        .from("sleep_logs")
        .select("source")
        .eq("user_id", userId)
        .eq("date", date)
        .maybeSingle();

      const sleepWrite =
        existingSleep?.source === "garmin" ||
        existingSleep?.source === "fitbit" ||
        existingSleep?.source === "apple_health" ||
        existingSleep?.source === "health_connect"
          ? Promise.resolve()
          : supabase
              .from("sleep_logs")
              .upsert({ user_id: userId, date, hours: sleep_hours, source: "manual" }, { onConflict: "user_id,date" });

      await Promise.all([
        supabase.from("mood_logs").upsert({ user_id: userId, date, mood_value }, { onConflict: "user_id,date" }),
        sleepWrite,
      ]);
      const streakCount = await updateStreak(supabase, userId);
      trackEvent("check_in", {
        mood: mood_value,
        sleep_hours,
      });
      if (typeof streakCount === "number") {
        trackEvent("streak_updated", {
          streak_count: streakCount,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", userId] });
      queryClient.invalidateQueries({ queryKey: ["progress", userId] });
    },
  });

  return {
    data,
    loading: isLoading,
    dadDates: data?.dadDates ?? [],
    dadsCount: appStats?.dadsCount ?? 0,
    checkIn,
  };
}
