import type { NotificationPayload } from "@/lib/notifications/types";
import type { NotificationType } from "@/types/database";

const JOURNAL_PROMPTS = [
  "What’s one small win you had today?",
  "What stressed you today — and what helped?",
  "What’s one thing you can do tomorrow to feel better?",
  "What made you feel connected to your kid today?",
  "What’s one habit you want to protect this week?",
];

export function pickJournalPrompt(seed: string): string {
  // seed should be stable per day (e.g., localDate)
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return JOURNAL_PROMPTS[h % JOURNAL_PROMPTS.length]!;
}

export function buildPayload(args: {
  type: NotificationType;
  weeklyScore?: number | null;
  streakDays?: number | null;
  weeklyChallenge?: { title: string; description?: string | null } | null;
  milestoneText?: string | null;
  journalPrompt?: string | null;
}): NotificationPayload {
  const t = args.type;

  if (t === "morning_checkin") {
    return { type: t, heading: "Morning check-in", content: "Good morning. How are you feeling today?", link: "/" };
  }
  if (t === "bedtime_story") {
    return { type: t, heading: "Bedtime soon", content: "Bedtime in 30 minutes. Story time?", link: "/bond" };
  }
  if (t === "workout_window") {
    return { type: t, heading: "Workout window", content: "Your workout window is now. 20 minutes is enough.", link: "/fitness" };
  }
  if (t === "weekly_score") {
    const score = typeof args.weeklyScore === "number" ? args.weeklyScore : null;
    return {
      type: t,
      heading: "Weekly report ready",
      content: `Your Dad Health Score this week: ${score == null ? "—" : score}`,
      link: "/progress",
    };
  }
  if (t === "streak_at_risk") {
    const n = typeof args.streakDays === "number" ? args.streakDays : null;
    return {
      type: t,
      heading: "Streak at risk",
      content: `Your ${n == null ? "" : `${n}-day `}streak ends at midnight.`.replace("  ", " ").trim(),
      link: "/",
    };
  }
  if (t === "weekly_challenge") {
    const title = args.weeklyChallenge?.title?.trim() || "Weekly challenge";
    const desc = args.weeklyChallenge?.description?.trim();
    return {
      type: t,
      heading: title,
      content: desc || "New weekly challenge is live.",
      link: "/",
    };
  }
  if (t === "journal_prompt") {
    const prompt = args.journalPrompt?.trim() || "Write one sentence about your day.";
    return { type: t, heading: "Journal prompt", content: prompt, link: "/mind" };
  }
  if (t === "milestone_anniversary") {
    return {
      type: t,
      heading: "Milestone",
      content: `One year ago: ${args.milestoneText?.trim() || "a special moment"}`,
      link: "/bond",
    };
  }

  // Event-driven types are built by their event handlers with entity identifiers.
  throw new Error(`Notification type ${t} requires an event-specific payload`);
}

