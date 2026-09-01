import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/utils/supabase/admin";
import type { NotificationType } from "@/types/database";
import { buildPayload, pickJournalPrompt } from "@/lib/notifications/buildPayload";
import { sendRateLimitedNotification } from "@/lib/notifications/delivery";
import { getLocalParts, hhmmFromPgTime, isInWindow, subtractMinutes } from "@/lib/notifications/time";

type PrefRow = {
  user_id: string;
  notification_type: NotificationType;
  enabled: boolean;
  send_time: string | null;
};

function requireCronSecret(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  if (request.headers.get("authorization") === `Bearer ${expected}`) return true;
  const got = request.headers.get("x-cron-secret") || request.headers.get("cron_secret");
  if (got !== expected) return false;
  return true;
}

function ymdAddDays(ymd: string, days: number): string {
  // Interpret as UTC midnight to keep it stable.
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ymdAddYears(ymd: string, years: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function calcScore(
  moodAvg: number | null,
  sleepAvg: number | null,
  workoutCount: number,
  journalCount: number
): number | null {
  if (moodAvg == null || sleepAvg == null) return null;
  const moodScore = Math.min(100, (moodAvg / 4) * 30);
  const sleepScore = Math.min(30, (sleepAvg / 8) * 30);
  const workoutScore = Math.min(25, workoutCount * 3);
  const journalScore = Math.min(15, journalCount * 2);
  return Math.round(Math.min(100, moodScore + sleepScore + workoutScore + journalScore));
}

async function computeWeeklyScore(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string, endLocalDate: string) {
  const start = ymdAddDays(endLocalDate, -6);
  const end = endLocalDate;

  const [moodRes, sleepRes, workoutRes, journalRes] = await Promise.all([
    admin.from("mood_logs").select("mood_value").eq("user_id", userId).gte("date", start).lte("date", end),
    admin.from("sleep_logs").select("hours").eq("user_id", userId).gte("date", start).lte("date", end),
    admin
      .from("workout_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("performed_at", `${start}T00:00:00Z`)
      .lte("performed_at", `${end}T23:59:59Z`),
    admin
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", `${start}T00:00:00Z`)
      .lte("created_at", `${end}T23:59:59Z`),
  ]);

  const mood = (moodRes.data ?? []).map((r: { mood_value: number }) => r.mood_value).filter((n) => Number.isFinite(n));
  const sleep = (sleepRes.data ?? []).map((r: { hours: number }) => r.hours).filter((n) => Number.isFinite(n));

  const moodAvg = mood.length ? mood.reduce((a, b) => a + b, 0) / mood.length : null;
  const sleepAvg = sleep.length ? sleep.reduce((a, b) => a + b, 0) / sleep.length : null;
  const workoutCount = workoutRes.count ?? 0;
  const journalCount = journalRes.count ?? 0;

  return calcScore(moodAvg, sleepAvg, workoutCount, journalCount);
}

async function processPresentDadCompletions(admin: ReturnType<typeof createAdminSupabaseClient>, now: Date) {
  const nowIso = now.toISOString();
  const completionResult = await admin
    .from("present_dad_sessions")
    .update({ status: "completed", completed_at: nowIso })
    .eq("status", "active")
    .lte("ends_at", nowIso);
  if (completionResult.error) throw completionResult.error;

  const pendingResult = await admin
    .from("present_dad_sessions")
    .select("id,user_id")
    .eq("status", "completed")
    .is("notification_attempted_at", null)
    .is("notification_sent_at", null)
    .limit(100);
  if (pendingResult.error) throw pendingResult.error;

  let sent = 0;
  let skipped = 0;
  let errors = 0;
  for (const session of pendingResult.data ?? []) {
    const claimResult = await admin
      .from("present_dad_sessions")
      .update({ notification_attempted_at: nowIso })
      .eq("id", session.id)
      .is("notification_attempted_at", null)
      .select("id")
      .maybeSingle();
    if (claimResult.error) { errors++; continue; }
    if (!claimResult.data) continue;

    try {
      const [profileResult, preferenceResult] = await Promise.all([
        admin.from("user_profile").select("push_notifications_enabled,timezone").eq("user_id", session.user_id).maybeSingle(),
        admin.from("notification_preferences").select("enabled").eq("user_id", session.user_id).eq("notification_type", "present_dad_mode_complete").maybeSingle(),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (preferenceResult.error) throw preferenceResult.error;
      if (profileResult.data?.push_notifications_enabled !== true || preferenceResult.data?.enabled !== true) {
        console.info("[notifications/dispatch] Present Dad notification skipped by settings", {
          user: session.user_id.slice(0, 8),
          masterEnabled: profileResult.data?.push_notifications_enabled === true,
          typeEnabled: preferenceResult.data?.enabled === true,
        });
        skipped++;
        continue;
      }

      const delivery = await sendRateLimitedNotification({
        admin,
        userId: session.user_id,
        type: "present_dad_mode_complete",
        timezone: profileResult.data.timezone?.trim() || "UTC",
        eventKey: session.id,
        payload: {
          type: "present_dad_mode_complete",
          heading: "Present Dad Mode complete",
          content: "You completed 60 minutes of focused time.",
          link: "/bond",
          data: { session_id: session.id },
        },
      });
      if (delivery === "limited") { skipped++; continue; }
      const sentResult = await admin.from("present_dad_sessions").update({ notification_sent_at: new Date().toISOString() }).eq("id", session.id);
      if (sentResult.error) throw sentResult.error;
      sent++;
    } catch (error) {
      errors++;
      console.error("[notifications/dispatch] Present Dad completion failed", { sessionId: session.id, error });
      await admin.from("present_dad_sessions").update({ notification_attempted_at: null }).eq("id", session.id).is("notification_sent_at", null);
    }
  }
  return { sent, skipped, errors };
}

export async function GET(request: Request) {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const now = new Date();
    console.info("[notifications/dispatch] Run started", { now: now.toISOString() });
    const presentDadResult = await processPresentDadCompletions(admin, now);

    const prefsRes = await admin
      .from("notification_preferences")
      .select("user_id, notification_type, enabled, send_time")
      .eq("enabled", true);

    if (prefsRes.error) throw prefsRes.error;
    const prefs = (prefsRes.data ?? []) as PrefRow[];

    const userIds = Array.from(new Set(prefs.map((p) => p.user_id)));
    if (userIds.length === 0) {
      console.info("[notifications/dispatch] Run completed", { ...presentDadResult, scheduledUsers: 0 });
      return NextResponse.json({ ok: true, ...presentDadResult });
    }

    const profilesRes = await admin
      .from("user_profile")
      .select("user_id, timezone, push_notifications_enabled")
      .in("user_id", userIds);
    if (profilesRes.error) throw profilesRes.error;

    const pushEnabledByUser = new Map<string, boolean>(
      (profilesRes.data ?? []).map(
        (r: { user_id: string; push_notifications_enabled?: boolean | null }) => [r.user_id, Boolean(r.push_notifications_enabled)],
      ),
    );

    const tzByUser = new Map<string, string>(
      (profilesRes.data ?? []).map((r: { user_id: string; timezone?: string | null }) => [
        r.user_id,
        (r.timezone?.trim() || "UTC") as string,
      ])
    );

    let sent = presentDadResult.sent;
    let skipped = presentDadResult.skipped;
    let errors = presentDadResult.errors;

    // Cache weekly challenge once per run (only used Mondays 8am local)
    let cachedChallenge: { title: string; description?: string | null } | null | undefined;

    for (const userId of userIds) {
      if (!pushEnabledByUser.get(userId)) {
        skipped += prefs.filter((p) => p.user_id === userId).length;
        continue;
      }

      const timeZone = tzByUser.get(userId) ?? "UTC";
      const { localDate, localDow, localHHMM } = getLocalParts(now, timeZone);

      const userPrefs = prefs.filter((p) => p.user_id === userId);

      // Optional lookups (only when needed)
      let hasCheckinToday: boolean | null = null;
      let streakDays: number | null = null;
      let milestoneText: string | null = null;
      let weeklyScore: number | null = null;

      for (const pref of userPrefs) {
        const type = pref.notification_type;

        let due = false;
        let journalPrompt: string | null = null;

        if (type === "morning_checkin") {
          due = isInWindow(localHHMM, "07:30");
        } else if (type === "weekly_score") {
          // The weekly Dad Health report lands on Sunday. `computeWeeklyScore`
          // still ends on yesterday, so the window stays a complete seven days.
          due = localDow === 0 && isInWindow(localHHMM, "08:00");
        } else if (type === "weekly_challenge") {
          due = localDow === 1 && isInWindow(localHHMM, "08:00");
        } else if (type === "streak_at_risk") {
          due = isInWindow(localHHMM, "21:00");
          if (due) {
            if (hasCheckinToday == null) {
              const checkRes = await admin
                .from("mood_logs")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId)
                .eq("date", localDate);
              hasCheckinToday = (checkRes.count ?? 0) > 0;
            }
            due = !hasCheckinToday;
          }
        } else if (type === "bedtime_story") {
          if (pref.send_time) {
            const bedtime = hhmmFromPgTime(pref.send_time);
            const reminder = subtractMinutes(bedtime, 30);
            due = isInWindow(localHHMM, reminder);
          }
        } else if (type === "workout_window") {
          if (pref.send_time) {
            due = isInWindow(localHHMM, hhmmFromPgTime(pref.send_time));
          }
        } else if (type === "journal_prompt") {
          if (pref.send_time) {
            due = isInWindow(localHHMM, hhmmFromPgTime(pref.send_time));
          }
          if (due) journalPrompt = pickJournalPrompt(localDate);
        } else if (type === "milestone_anniversary") {
          // Run daily at 08:00 local; send only if there is a milestone exactly 1 year ago.
          due = isInWindow(localHHMM, "08:00");
          if (due) {
            const oneYearAgo = ymdAddYears(localDate, -1);
            const mRes = await admin
              .from("milestones")
              .select("text")
              .eq("user_id", userId)
              .eq("date", oneYearAgo)
              .maybeSingle();
            milestoneText = (mRes.data as { text?: string } | null)?.text ?? null;
            due = Boolean(milestoneText);
          }
        }

        if (!due) continue;

        console.info("[notifications/dispatch] Notification is due", {
          user: userId.slice(0, 8),
          type,
          localDate,
          localTime: localHHMM,
        });

        // Dynamic payload pieces for notifications that are currently due.
        let weeklyChallenge: { title: string; description?: string | null } | null = null;

        if (type === "weekly_challenge") {
          if (cachedChallenge === undefined) {
            const cRes = await admin
              .from("weekly_challenges")
              .select("title, description")
              .eq("active", true)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            cachedChallenge = (cRes.data as { title: string; description?: string | null } | null) ?? null;
          }
          weeklyChallenge = cachedChallenge ?? null;
          if (!weeklyChallenge) {
            skipped += 1;
            continue;
          }
        }

        if (type === "weekly_score") {
          weeklyScore = await computeWeeklyScore(admin, userId, ymdAddDays(localDate, -1));
        }

        if (type === "streak_at_risk") {
          const sRes = await admin.from("user_streaks").select("streak_count").eq("user_id", userId).maybeSingle();
          streakDays = (sRes.data as { streak_count?: number } | null)?.streak_count ?? null;
        }

        const payload = buildPayload({
          type,
          weeklyScore,
          streakDays,
          weeklyChallenge,
          milestoneText,
          journalPrompt,
        });

        try {
          const delivery = await sendRateLimitedNotification({
            admin,
            userId,
            type,
            timezone: timeZone,
            payload,
          });
          if (delivery === "sent") sent++;
          else skipped++;
        } catch (e) {
          console.error("[notifications/dispatch] OneSignal send failed", { userId, type, e });
          errors++;
        }
      }
    }

    console.info("[notifications/dispatch] Run completed", {
      sent,
      skipped,
      errors,
      scheduledUsers: userIds.length,
    });
    return NextResponse.json({ ok: true, sent, skipped, errors });
  } catch (e) {
    console.error("[notifications/dispatch]", e);
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
