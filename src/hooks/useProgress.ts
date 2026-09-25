"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/utils/supabaseClient";

export function useProgress(userId?: string) {
  return useQuery({
    queryKey: ["progress", userId],
    queryFn: async () => {
      if (!userId) {
        return {
          scoreData: null,
          reportStats: null,
          sleepLogs: [],
          moodLogs: [],
          badges: [],
          earnedBadges: [],
          integrations: [],
          bodyMetrics: [],
        };
      }

      const now = new Date();
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const start = weekAgo.toISOString().slice(0, 10);
      const end = now.toISOString().slice(0, 10);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const monthEnd = end;

      const [
        moodRes,
        scoreRes,
        sleepRes,
        workoutMonthRes,
        journalMonthRes,
        milestonesRes,
        sleepMonthRes,
        streakRes,
        moodMonthRes,
        badgesRes,
        earnedBadgesRes,
        bodyMetricsRes,
        integrationsRes,
      ] = await Promise.all([
        supabase.from("mood_logs").select("date, mood_value").eq("user_id", userId).gte("date", start).lte("date", end),
        supabase.from("dad_score_view").select("mind_score, body_score, bond_score, total_score, weakest_pillar, recommended_action").eq("user_id", userId).maybeSingle(),
        supabase.from("sleep_logs").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(14),
        supabase
          .from("workout_sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("performed_at", monthStart)
          .lte("performed_at", monthEnd + "T23:59:59"),
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
          .lte("date", monthEnd),
        supabase.from("sleep_logs").select("hours").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd),
        supabase.from("user_streaks").select("streak_count").eq("user_id", userId).maybeSingle(),
        supabase.from("mood_logs").select("mood_value").eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd),
        supabase.from("badges").select("*"),
        supabase
          .from("earned_badges")
          .select("badge_id, badges(icon, name)")
          .eq("user_id", userId),
        supabase
          .from("body_metrics")
          .select("metric_type,value,recorded_at,source")
          .eq("user_id", userId)
          .gte("recorded_at", start)
          .lte("recorded_at", end + "T23:59:59")
          .order("recorded_at", { ascending: false }),
        supabase
          .from("user_integrations")
          .select("provider,device_name,last_sync_at,connected_at")
          .eq("user_id", userId)
          .order("last_sync_at", { ascending: false, nullsFirst: false }),
      ]);

      const bodyMetricRows = (bodyMetricsRes.data ?? []) as Array<{
        metric_type: string;
        value: number;
        recorded_at: string;
        source?: string | null;
      }>;
      const score = scoreRes.error ? null : scoreRes.data;

      const workouts = workoutMonthRes.count ?? 0;
      const journal = journalMonthRes.count ?? 0;
      const dadDates = milestonesRes.count ?? 0;
      const streak = streakRes.data?.streak_count ?? 0;
      const sleepData = sleepMonthRes.data ?? [];
      const avgSleep =
        sleepData.length > 0
          ? sleepData.reduce((a: number, b: { hours: number }) => a + b.hours, 0) / sleepData.length
          : null;
      const moodData = moodMonthRes.data ?? [];
      const moodMonthAvg =
        moodData.length > 0
          ? moodData.reduce((a: number, b: { mood_value: number }) => a + b.mood_value, 0) / moodData.length
          : null;
      const avgMood =
        moodMonthAvg == null
          ? null
          : moodMonthAvg >= 3.5
            ? "Good"
            : moodMonthAvg >= 2.5
              ? "Okay"
              : "Low";

      const earnedBadges = (earnedBadgesRes.data ?? [])
        .map((e: { badge_id: string; badges: { icon: string; name: string } | { icon: string; name: string }[] | null }) => {
          const badge = Array.isArray(e.badges) ? e.badges[0] : e.badges;
          return {
            icon: badge?.icon,
            name: badge?.name,
          };
        })
        .filter((b): b is { icon: string; name: string } => Boolean(b.icon && b.name));

      return {
        scoreData: {
          score: typeof score?.total_score === "number" ? Math.round(score.total_score) : null,
          breakdown: {
            mind: typeof score?.mind_score === "number" ? Math.round(score.mind_score) : null,
            body: typeof score?.body_score === "number" ? Math.round(score.body_score) : null,
            bond: typeof score?.bond_score === "number" ? Math.round(score.bond_score) : null,
          },
          weakestPillar: score?.weakest_pillar ?? null,
          recommendedAction: score?.recommended_action ?? null,
        },
        reportStats: {
          workouts,
          journal,
          dadDates,
          avgSleep: avgSleep == null ? null : Math.round(avgSleep * 10) / 10,
          streak,
          avgMood,
        },
        sleepLogs: sleepRes.data ?? [],
        moodLogs: moodRes.data ?? [],
        badges: badgesRes.data ?? [],
        earnedBadges,
        bodyMetrics: bodyMetricRows,
        integrations: integrationsRes.data ?? [],
      };
    },
    enabled: true,
  });
}
