"use client";

import { useMemo } from "react";
import { getCurrentWeekDayKeys, getDashboardScore, getMoodSummary, getMoodWeek, getReportStatsList, getScoreBreakdown } from "@/lib/dashboard.utils";
import { greetingDisplayName } from "@/lib/userDisplay";
import type { User } from "@supabase/supabase-js";
import type { CircleItem, DadDateItem, MilestoneItem, ReminderItem, ScoreItem } from "./types";

type UseDashboardPreviewDataArgs = {
  dashboard: Record<string, unknown> | null | undefined;
  profile: { display_name?: string | null } | null | undefined;
  user: User | null;
  communityPosts: Record<string, unknown>[];
};

export function useDashboardPreviewData({
  dashboard,
  profile,
  user,
  communityPosts,
}: UseDashboardPreviewDataArgs) {
  const hasUser = Boolean(user);
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const moodLogs = useMemo(
    () =>
      (dashboard?.mood_logs as Array<{ date: string; mood_value: number }> | undefined) ??
      (dashboard?.mood_value != null
        ? [{ date: (dashboard?.date as string | undefined) ?? today, mood_value: dashboard.mood_value as number }]
        : []),
    [dashboard?.mood_logs, dashboard?.mood_value, dashboard?.date, today],
  );

  const hasCheckedInToday = useMemo(
    () => moodLogs.some((m) => m.date === today),
    [moodLogs, today],
  );

  const score = useMemo(() => getDashboardScore(dashboard, hasUser), [dashboard, hasUser]);
  const breakdown = useMemo(() => getScoreBreakdown(dashboard, hasUser), [dashboard, hasUser]);
  const scoreItems = useMemo<ScoreItem[]>(
    () => [
      { label: "MIND", value: breakdown.mind },
      { label: "BODY", value: breakdown.body },
      { label: "BOND", value: breakdown.bond },
    ],
    [breakdown],
  );

  const streak = (dashboard?.streak_count as number | undefined) ?? 0;
  const last7 = useMemo(() => getCurrentWeekDayKeys(), []);
  const moodWeek = useMemo(() => getMoodWeek(moodLogs, last7), [moodLogs, last7]);
  const moodSummary = useMemo(() => getMoodSummary(moodWeek, hasUser), [moodWeek, hasUser]);

  const greetingName = greetingDisplayName(
    { display_name: profile?.display_name ?? (dashboard?.display_name as string | undefined) },
    user,
  );
  const displayNameShort = useMemo(() => greetingName.split(/\s+/)[0] ?? greetingName, [greetingName]);

  const monthWorkouts = (dashboard?.month_workouts as number | undefined) ?? 0;
  const dates = useMemo(
    () =>
      ((dashboard?.dad_dates as DadDateItem[] | undefined) ?? []).slice(0, 3),
    [dashboard?.dad_dates],
  );
  const reminders = useMemo(
    () =>
      ((dashboard?.reminders as ReminderItem[] | undefined) ?? []).slice(0, 5),
    [dashboard?.reminders],
  );
  const circles = useMemo(
    () =>
      ((dashboard?.circles as CircleItem[] | undefined) ?? []).slice(0, 3),
    [dashboard?.circles],
  );
  const milestones = useMemo(
    () =>
      ((dashboard?.milestones as MilestoneItem[] | undefined) ?? []).slice(0, 6),
    [dashboard?.milestones],
  );
  const bodyWeekSeries = useMemo(() => {
    const values = (dashboard?.body_week_series as number[] | undefined) ?? [];
    if (values.length === 7) return values;
    return Array.from({ length: 7 }, () => 0);
  }, [dashboard?.body_week_series]);
  const displayPosts = useMemo(
    () => communityPosts.slice(0, 3),
    [communityPosts],
  );
  const reportStatsList = useMemo(() => getReportStatsList(dashboard?.reportStats), [dashboard?.reportStats]);
  const badges = useMemo(
    () => ((dashboard?.badges as Array<{ icon: string; name: string }> | undefined) ?? []).slice(0, 4),
    [dashboard?.badges],
  );
  const reportMonthLabel = useMemo(() => now.toLocaleString("en-GB", { month: "long" }).toUpperCase(), [now]);

  const featuredWorkoutTitle =
    (dashboard?.featured_workout_title as string | undefined) ?? "";
  const featuredWorkoutMeta =
    (dashboard?.featured_workout_meta as string | undefined) ?? "";

  return {
    hasUser,
    now,
    today,
    moodLogs,
    hasCheckedInToday,
    score,
    scoreItems,
    streak,
    moodWeek,
    moodSummary,
    greetingName,
    displayNameShort,
    monthWorkouts,
    dates,
    reminders,
    circles,
    milestones,
    bodyWeekSeries,
    displayPosts,
    reportStatsList,
    badges,
    reportMonthLabel,
    featuredWorkoutTitle,
    featuredWorkoutMeta,
  };
}
