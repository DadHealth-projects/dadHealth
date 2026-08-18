"use client";

import { useCallback } from "react";
import SitePageShell from "@/components/SitePageShell";
import SiteFooter from "@/components/SiteFooter";
import OutlineButton from "@/components/OutlineButton";
import { ProGate } from "@/components/ProProvider";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useProgress } from "@/hooks/useProgress";
import { toast } from "@/hooks/use-toast";

const ProgressPage = () => {
  const { user } = useAuth();
  const { data } = useProgress(user?.id);
  const scoreData = data?.scoreData;
  const reportStats = data?.reportStats;
  const sleepLogs = data?.sleepLogs ?? [];
  const moodLogs = data?.moodLogs ?? [];
  const badges = data?.badges ?? [];
  const earnedBadges = data?.earnedBadges ?? [];
  const integrations = data?.integrations ?? [];
  const bodyMetrics = data?.bodyMetrics ?? [];

  const dadScore = user && typeof scoreData?.score === "number" ? scoreData.score : null;
  const breakdown = user
    ? (scoreData?.breakdown ?? { mind: null, body: null, bond: null })
    : { mind: null, body: null, bond: null };

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { key: d.toISOString().slice(0, 10), day: format(d, "EEE") };
  });
  const sleepMap = new Map(sleepLogs.map((s: { date: string; hours: number }) => [s.date, s.hours]));
  const moodMap = new Map(moodLogs.map((m: { date: string; mood_value: number }) => [m.date, m.mood_value]));
  const sleepData = last7.map(({ key, day }) => ({ day, hrs: sleepMap.get(key) ?? 0 }));
  const moodWeekData = last7.map(({ key }) => moodMap.get(key) ?? 0);

  const displaySleep = user ? sleepData : last7.map(({ day }) => ({ day, hrs: 0 }));
  const displayMood = user ? moodWeekData : [0, 0, 0, 0, 0, 0, 0];

  const reportStatsList = reportStats
    ? [
        [String(reportStats.workouts), "Workouts"],
        [String(reportStats.journal), "Journal entries"],
        [String(reportStats.dadDates), "Dad dates"],
        [reportStats.avgSleep == null ? "—" : `${reportStats.avgSleep}h`, "Avg sleep"],
        [String(reportStats.streak), "Day streak"],
        [reportStats.avgMood ?? "—", "Avg mood"],
      ]
    : [];
  const latestIntegration = integrations
    .filter((item: { last_sync_at?: string | null }) => Boolean(item.last_sync_at))
    .sort((a: { last_sync_at?: string | null }, b: { last_sync_at?: string | null }) =>
      new Date(b.last_sync_at || 0).getTime() - new Date(a.last_sync_at || 0).getTime()
    )[0];
  const latestSteps = bodyMetrics.find((metric: { metric_type: string }) => metric.metric_type === "steps");
  const latestActiveMins = bodyMetrics.find((metric: { metric_type: string }) => metric.metric_type === "active_mins");
  const formatProvider = (provider?: string | null) =>
    provider === "fitbit"
      ? "Fitbit"
      : provider === "garmin"
        ? "Garmin"
        : provider === "apple_health"
          ? "Apple Health"
          : "wearable";
  const formatSyncTime = (value?: string | null) => {
    if (!value) return "Not synced yet";
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const dayLabel =
      date.toDateString() === today.toDateString()
        ? "today"
        : date.toDateString() === yesterday.toDateString()
          ? "yesterday"
          : date.toLocaleDateString();
    return `${dayLabel} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  };
  const syncStatus = latestIntegration
    ? `Last synced: ${formatSyncTime(latestIntegration.last_sync_at)} via ${formatProvider(latestIntegration.provider)}`
    : integrations.length > 0
      ? "Wearable connected. First sync pending."
      : "No wearable connected.";

  const handleShareReport = useCallback(async () => {
    const text = `My Dad Health Score: ${dadScore ?? "Not available yet"}${dadScore != null ? "/100" : ""}. Track your dad health at Dad Health.`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "My Dad Health Report",
          text,
          url: typeof window !== "undefined" ? window.location.origin : "",
        });
        toast({ description: "Report shared!" });
      } else {
        await navigator.clipboard.writeText(text);
        toast({ description: "Report copied to clipboard!" });
      }
    } catch {
      toast({ description: "Share cancelled", variant: "destructive" });
    }
  }, [dadScore]);

  const displayBadges = earnedBadges.length > 0 ? earnedBadges : badges;
  const moodSleepPairs = displaySleep
    .map((sleep, idx) => ({ sleep: sleep.hrs, mood: displayMood[idx] ?? 0 }))
    .filter((pair) => pair.sleep > 0 && pair.mood > 0);
  const highSleep = moodSleepPairs.filter((pair) => pair.sleep >= 7);
  const lowSleep = moodSleepPairs.filter((pair) => pair.sleep < 7);
  const highSleepMoodAvg =
    highSleep.length > 0
      ? highSleep.reduce((sum, pair) => sum + pair.mood, 0) / highSleep.length
      : null;
  const lowSleepMoodAvg =
    lowSleep.length > 0
      ? lowSleep.reduce((sum, pair) => sum + pair.mood, 0) / lowSleep.length
      : null;
  const sleepPatternMessage =
    highSleepMoodAvg != null && lowSleepMoodAvg != null && lowSleepMoodAvg > 0
      ? `Your mood score is ${Math.round(((highSleepMoodAvg - lowSleepMoodAvg) / lowSleepMoodAvg) * 100)}% higher on days after 7+ hours sleep.`
      : "Log more mood and sleep check-ins to unlock pattern insights.";

  return (
    <SitePageShell>
      {/* Score */}
      <section className="bg-background border-b border-border">
        <div className="w-full px-5 lg:px-8 py-10">
            <span className="section-label !p-0 mb-4 block">YOUR DAD HEALTH SCORE</span>
            <div className="flex flex-wrap gap-8 items-center">
              <div className="w-[100px] h-[100px] border-4 border-primary rounded-full flex flex-col items-center justify-center shrink-0">
                <div className="font-heading text-[36px] font-extrabold text-primary leading-none">{dadScore ?? "—"}</div>
                <div className="font-heading text-[9px] font-bold tracking-wider uppercase text-muted-foreground">{user ? "out of 100" : ""}</div>
              </div>
              <ProGate
                featureName="Dad Health Score breakdown"
                lockMessage="Free users see the number. Pro shows you exactly what's dragging it down — and how to fix it."
                className="flex-1 min-w-[200px] w-full max-w-sm"
              >
                <div className="w-full min-w-[220px] flex-1">
                  {[
                    { label: "Mind", value: breakdown.mind },
                    { label: "Body", value: breakdown.body },
                    { label: "Bond", value: breakdown.bond },
                  ].map((item) => {
                    const numVal = typeof item.value === "number" ? item.value : 0;
                    const displayVal = typeof item.value === "number" ? `${item.value}%` : "—";
                    return (
                      <div key={item.label} className="mb-2.5">
                        <div className="flex justify-between font-heading text-[11px] font-bold uppercase text-muted-foreground tracking-wide mb-1">
                          <span>{item.label}</span>
                          <span className="text-primary">{displayVal}</span>
                        </div>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${numVal}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ProGate>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="text-[10px] font-heading font-bold uppercase tracking-wide text-muted-foreground">Sync status</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{user ? syncStatus : "Sign in to sync wearables."}</div>
              </div>
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="text-[10px] font-heading font-bold uppercase tracking-wide text-muted-foreground">Steps</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {latestSteps?.value == null ? "No wearable data" : Number(latestSteps.value).toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="text-[10px] font-heading font-bold uppercase tracking-wide text-muted-foreground">Active minutes</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {latestActiveMins?.value == null ? "No wearable data" : `${Math.round(Number(latestActiveMins.value))} min`}
                </div>
              </div>
            </div>
        </div>
      </section>

      {/* Report card */}
      <section className="bg-primary text-primary-foreground">
        <div className="w-full px-5 lg:px-8 py-10">
            <h2 className="font-heading text-[22px] font-extrabold uppercase tracking-wide mb-4">{format(new Date(), "MMMM")} report card</h2>
            {reportStatsList.length === 0 ? (
              <p className="text-xs opacity-70">No monthly report data yet.</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                {reportStatsList.map(([n, l]) => (
                  <div key={l} className="bg-primary-foreground/[0.07] p-3.5">
                    <div className="font-heading text-[22px] font-extrabold leading-none">{n}</div>
                    <div className="text-[10px] opacity-55 mt-1.5 uppercase tracking-wide">{l}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <OutlineButton dark onClick={handleShareReport}>Share report card</OutlineButton>
            </div>
        </div>
      </section>

      <div className="w-full px-5 lg:px-8">
        <div className="flex flex-col w-full">
            {/* Badges */}
            <div className="py-8 w-full">
              <span className="section-label !p-0 mb-4 block">DH BADGES EARNED</span>
              <div className="flex gap-3 flex-wrap">
                {displayBadges.length > 0 ? displayBadges.map((b: { icon: string; name: string }) => (
                  <div
                    key={b.name}
                    className="flex flex-col items-center gap-1.5 p-2.5 border border-primary/20 bg-primary/[0.04] min-w-[60px]"
                  >
                    <span className="text-2xl">{b.icon}</span>
                    <span className="font-heading text-[9px] font-bold text-primary uppercase tracking-wide text-center leading-tight">
                      {b.name}
                    </span>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground">No badges earned yet.</p>
                )}
              </div>
            </div>

            {/* Sleep - Pro gated */}
            <div className="py-8 border-t border-border w-full">
              <span className="section-label !p-0 mb-4 block">SLEEP QUALITY THIS WEEK</span>
              <ProGate
                featureName="Sleep tracker"
                lockMessage="Your sleep is connected to your mood, your patience and your energy. This shows you exactly how."
              >
                <div>
                  <div className="flex items-end gap-1.5 h-[80px] mb-3">
                    {displaySleep.map((s: { day: string; hrs: number }, i: number) => {
                      const h = Math.min(Math.round((s.hrs / 10) * 70) + 4, 65);
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div
                            className={`w-full transition-all ${s.hrs >= 7 ? "bg-primary" : s.hrs >= 6 ? "bg-primary/40" : "bg-muted"
                              }`}
                            style={{ height: `${h}px` }}
                          />
                          <span className="font-heading text-[9px] font-bold text-muted-foreground">{s.day}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="p-3 bg-primary/[0.06] border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                    <span className="text-primary font-semibold">Pattern spotted:</span> {sleepPatternMessage}
                  </div>
                </div>
              </ProGate>
            </div>

            {/* Mood correlation */}
            <div className="py-8 border-t border-border w-full">
              <div className="bg-primary text-primary-foreground p-5 w-full">
                <h3 className="font-heading text-lg font-extrabold uppercase tracking-wide mb-3">Mood correlation</h3>
                <div className="flex gap-3 mb-3">
                  {displaySleep.map((s: { day: string; hrs: number }, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full h-10 bg-primary-foreground/[0.08] relative overflow-hidden">
                        <div
                          className="absolute bottom-0 left-0 right-0 bg-primary-foreground/60"
                          style={{ height: `${Math.min(Math.round((s.hrs / 10) * 100), 100)}%` }}
                        />
                      </div>
                      <div className="w-full h-10 bg-primary-foreground/[0.08] relative overflow-hidden">
                        <div
                          className="absolute bottom-0 left-0 right-0 bg-primary-foreground/35"
                          style={{ height: `${Math.min(Math.round(((displayMood[i] ?? 3) / 4) * 100), 100)}%` }}
                        />
                      </div>
                      <span className="font-heading text-[9px] font-bold opacity-50">{s.day}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 text-[11px] opacity-50">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 bg-primary-foreground/60" /> Sleep
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 bg-primary-foreground/35" /> Mood
                  </div>
                </div>
              </div>
            </div>
        </div>
      </div>
      <SiteFooter />
    </SitePageShell>
  );
};

export default ProgressPage;
