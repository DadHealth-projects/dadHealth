import { safeError } from '@/lib/safeError';
import { persistInbox, readNotificationRows } from '@/lib/notifications/inbox';
import { POST as handleSourceEvent } from '../events/route';
import { dispatchWeeklyReports } from "@/lib/reports/weekly-report-dispatch";
import { dispatchItem03Notifications } from '@/lib/notifications/item03-policy';
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

async function processPresentDadCompletions(admin: ReturnType<typeof createAdminSupabaseClient>, now: Date) {
  const nowIso = now.toISOString();
  const completionResult = await admin
    .from("present_dad_sessions")
    .update({ status: "completed", completed_at: nowIso })
    .eq("status", "active")
    .lte("ends_at", nowIso);
  if (completionResult.error) throw completionResult.error;

  const activation=await admin.rpc('notification_inbox_started_at');
  if(activation.error) throw activation.error;
  const sessions = await readNotificationRows<{
    id: string; user_id: string; notification_attempted_at: string | null;
  }>((after, limit) => {
    let query = admin.from('present_dad_sessions')
      .select('id,user_id,notification_attempted_at')
      .eq('status', 'completed').gte('completed_duration_seconds', 3600)
      .gte('completed_at', activation.data).order('id', { ascending: true }).limit(limit);
    if (after) query = query.gt('id', after.id);
    return query;
  });

  let sent = 0;
  let skipped = 0;
  let errors = 0;
  for (const session of sessions) {
    try {
      await persistInbox(admin, session.user_id, session.id, {type:'present_dad_mode_complete',
        heading:'Present Dad Mode complete',content:'You completed 60 minutes of focused time.',link:'/bond',data:{session_id:session.id}});
    } catch { errors++; continue; }
    if (session.notification_attempted_at) continue;
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
    // Item 02 is independent of notification preferences and other notification jobs.
    let item03Result = { sent: 0, errors: 0 };
    let item03Ran = false;
    const runItem03 = async () => {
      if (item03Ran) return;
      item03Ran = true;
      item03Result = await dispatchItem03Notifications(admin).catch(() => ({ sent: 0, errors: 1 }));
    };
    const weeklyResult = await dispatchWeeklyReports(admin, now, runItem03).catch(() => ({ reports: 0, sent: 0, pending: 0, errors: 1 }));
    await runItem03(); // A capture failure must not prevent eligible daily/trial work.
    const presentDadResult = await processPresentDadCompletions(admin, now).catch(()=>({sent:0,skipped:0,errors:1}));
    const retrySources=await admin.rpc('notification_inbox_retry_sources');
    if(retrySources.error) presentDadResult.errors++;
    for(const source of retrySources.data ?? []) {
      const response=await handleSourceEvent(new Request('http://internal.invalid/api/notifications/events',{
        method:'POST',headers:{authorization:'Bearer '+(process.env.NOTIFICATION_WEBHOOK_SECRET?.trim() ?? ''),'content-type':'application/json'},body:JSON.stringify(source)}));
      if(!response.ok) presentDadResult.errors++;
    }

    const prefs = await readNotificationRows<PrefRow>((after, limit) => {
      let query = admin.from('notification_preferences')
        .select('user_id, notification_type, enabled, send_time')
        .order('user_id', { ascending: true })
        .order('notification_type', { ascending: true }).limit(limit);
      if (after) {
        query = query.or(`user_id.gt.${after.user_id},` +
          `and(user_id.eq.${after.user_id},notification_type.gt.${after.notification_type})`);
      }
      return query;
    });

    const allAccounts = await readNotificationRows<{ user_id: string }>((after, limit) => {
      let query = admin.from('user_profile').select('user_id')
        .order('user_id', { ascending: true }).limit(limit);
      if (after) query = query.gt('user_id', after.user_id);
      return query;
    });
    const userIds = allAccounts.map(row => row.user_id);
    if (userIds.length === 0) {
      console.info("[notifications/dispatch] Run completed", { ...presentDadResult, scheduledUsers: 0 });
      return NextResponse.json({ ok: true, ...presentDadResult, weekly: weeklyResult, item03: item03Result });
    }

    let sent = presentDadResult.sent;
    let skipped = presentDadResult.skipped;
    let errors = presentDadResult.errors;

    // Cache weekly challenge once per run (only used Mondays 8am local)
    let cachedChallenge: { id: string; title: string; description?: string | null } | null | undefined;

    for (const userId of userIds) {
      const context=await admin.rpc('item03_inbox_context',{p_user_id:userId});
      if(context.error){errors++;continue;}
      if(context.data?.allowed!==true) continue;
      const timeZone=context.data.timezone;
      const observedAt=new Date(context.data.observedAt);
      if(!Number.isFinite(observedAt.getTime())){errors++;continue;}
      const {localHHMM}=getLocalParts(observedAt,timeZone);
      const localDate=context.data.date as string;
      const localDow=new Date(localDate+'T00:00:00Z').getUTCDay();
      const userPrefs=prefs.filter(p=>p.user_id===userId);
      for (const type of ['weekly_challenge','milestone_anniversary'] as const) {
        if(!userPrefs.some(p=>p.notification_type===type)) userPrefs.push({user_id:userId,notification_type:type,enabled:false,send_time:null});
      }
      // Optional lookups (only when needed)
      let streakDays: number | null = null;
      let milestones: {id:string;text:string}[] = [];

      for (const pref of userPrefs) {
        const type = pref.notification_type;
        if (['weekly_score', 'morning_checkin', 'lowest_pillar', 'trial_ending', 'streak_at_risk'].includes(type)) continue;

        let due = false;
        let journalPrompt: string | null = null;

        if (type === "weekly_challenge") {
          due = localDow === 1 && isInWindow(localHHMM, "08:00");
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
              .select("id,text")
              .eq("user_id", userId)
              .eq("date", oneYearAgo);
            if(mRes.error){errors++;continue;}
            milestones=mRes.data ?? [];
            due=milestones.length>0;
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
        let weeklyChallenge: { id:string; title: string; description?: string | null } | null = null;

        if (type === "weekly_challenge") {
          if (cachedChallenge === undefined) {
            const cRes = await admin
              .from("weekly_challenges")
              .select("id, title, description")
              .eq("active", true)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            cachedChallenge = (cRes.data as { id:string; title: string; description?: string | null } | null) ?? null;
          }
          weeklyChallenge = cachedChallenge ?? null;
          if (!weeklyChallenge) {
            skipped += 1;
            continue;
          }
        }

        if (type === "streak_at_risk") {
          const sRes = await admin.from("user_streaks").select("streak_count").eq("user_id", userId).maybeSingle();
          streakDays = (sRes.data as { streak_count?: number } | null)?.streak_count ?? null;
        }

        for (const milestone of type==='milestone_anniversary' ? milestones : [null]) {
        const payload = buildPayload({
          type,
          streakDays,
          weeklyChallenge,
          milestoneText: milestone?.text,
          journalPrompt,
        });

        try {
          const delivery = await sendRateLimitedNotification({
            admin,
            userId,
            type,
            timezone: timeZone,
            eventKey: milestone ? 'milestone:'+milestone.id+':'+localDate.slice(0,4) : undefined,
            inboxSourceKey: milestone ? 'milestone:'+milestone.id+':'+localDate.slice(0,4)
              : type==='weekly_challenge' ? 'challenge:'+localDate+':'+weeklyChallenge!.id : type+':'+localDate,
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
    }

    console.info("[notifications/dispatch] Run completed", {
      sent,
      skipped,
      errors,
      scheduledUsers: userIds.length,
    });
    return NextResponse.json({ ok: true, sent, skipped, errors, weekly: weeklyResult, item03: item03Result });
  } catch (e) {
    console.error("[notifications/dispatch]", safeError(e));
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
