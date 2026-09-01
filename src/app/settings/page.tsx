"use client";

import SitePageShell from "@/components/SitePageShell";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, useUpdateProfile } from "@/hooks/useUserProfile";
import { useNotificationPreferences, useUpsertNotificationPreference } from "@/hooks/useNotificationPreferences";
import type { NotificationType } from "@/types/database";
import { Switch } from "@/components/ui/switch";
import { requestOneSignalPermission } from "@/components/OneSignalManager";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/utils/supabaseClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type WearableIntegration = {
  provider: "garmin" | "fitbit";
  device_name: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
};

const TYPES: Array<{
  type: NotificationType;
  title: string;
  description: string;
  linkLabel: string;
  needsTime?: boolean;
  timeHint?: string;
}> = [
  {
    type: "morning_checkin",
    title: "Morning check-in",
    description: "07:30 daily - Good morning. How are you feeling today?",
    linkLabel: "Home",
  },
  {
    type: "bedtime_story",
    title: "Bedtime story reminder",
    description: "30 minutes before your set bedtime - Bedtime in 30 minutes. Story time?",
    linkLabel: "Bond",
    needsTime: true,
    timeHint: "Bedtime (local time)",
  },
  {
    type: "workout_window",
    title: "Workout window",
    description: "At your set time - Your workout window is now. 20 minutes is enough.",
    linkLabel: "Fitness",
    needsTime: true,
    timeHint: "Workout time (local time)",
  },
  {
    type: "weekly_score",
    title: "Weekly score",
    description: "Sunday 08:00 - Your Dad Health Score this week: [score]",
    linkLabel: "Progress",
  },
  {
    type: "streak_at_risk",
    title: "Streak at risk",
    description: "21:00 if you have not checked in - Your [n]-day streak ends at midnight.",
    linkLabel: "Home",
  },
  {
    type: "weekly_challenge",
    title: "Weekly challenge",
    description: "Monday 08:00 - Weekly challenge title + description",
    linkLabel: "Home",
  },
  {
    type: "journal_prompt",
    title: "Journal prompt",
    description: "At your set evening time — rotating prompt",
    linkLabel: "Mind",
    needsTime: true,
    timeHint: "Evening time (local time)",
  },
  {
    type: "milestone_anniversary",
    title: "Milestone anniversary",
    description: "Date-matched — One year ago: [milestone text]",
    linkLabel: "Bond",
  },
];

function toHHMM(pgTime: string | null | undefined): string {
  if (!pgTime) return "";
  const m = /^(\d{2}):(\d{2})/.exec(pgTime);
  return m ? `${m[1]}:${m[2]}` : "";
}

function toPgTime(hhmm: string): string | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return `${m[1]}:${m[2]}:00`;
}

function formatProvider(provider: string) {
  return provider === "fitbit" ? "Fitbit" : "Garmin";
}

function formatSyncTime(value: string | null | undefined) {
  if (!value) return "Not synced yet";

  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = date.toDateString() === today.toDateString();
  const yesterdayDay = date.toDateString() === yesterday.toDateString();
  const dayLabel = sameDay ? "today" : yesterdayDay ? "yesterday" : date.toLocaleDateString();

  return `${dayLabel} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export default function SettingsPage() {
  const { user, openAuthModal } = useAuth();
  const { data: profile } = useUserProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const queryClient = useQueryClient();

  const { data: prefs = [], error: prefsError } = useNotificationPreferences(user?.id);
  const upsertPref = useUpsertNotificationPreference(user?.id);
  const { data: integrations = [], error: integrationsError } = useQuery({
    queryKey: ["wearable-integrations", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("user_integrations")
        .select("provider,device_name,connected_at,last_sync_at")
        .eq("user_id", user.id)
        .order("connected_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WearableIntegration[];
    },
    enabled: Boolean(user?.id),
  });
  const disconnectWearable = useMutation({
    mutationFn: async (provider: WearableIntegration["provider"]) => {
      const res = await fetch(`/api/integrations/${provider}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Unable to disconnect wearable");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["wearable-integrations", user?.id] });
      await queryClient.invalidateQueries({ queryKey: ["progress", user?.id] });
      toast({ description: "Wearable disconnected." });
    },
    onError: (error) => {
      logError("[settings] disconnect wearable failed", error);
      toast({ description: "Unable to disconnect wearable right now.", variant: "destructive" });
    },
  });

  const pushEnabled = Boolean(profile?.push_notifications_enabled);
  const timezone = profile?.timezone?.trim() || "";

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const canEditPrefCards = Boolean(user) && !prefsError;

  const logError = (label: string, error: unknown) => {
    if (process.env.NODE_ENV !== "production") {
      console.error(label, error);
    }
  };

  const handleMasterToggle = async (next: boolean) => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      await updateProfile.mutateAsync({
        push_notifications_enabled: next,
        timezone: timezone || browserTz,
      });
      if (next) {
        requestOneSignalPermission();
        toast({ description: "Push notifications enabled. Confirm the browser prompt to opt in." });
      } else {
        toast({ description: "Push notifications disabled." });
      }
    } catch (e) {
      logError("[settings] updateProfile failed", e);
      toast({ description: "Unable to save settings right now. Please try again.", variant: "destructive" });
    }
  };

  const handleTypeToggle = async (type: NotificationType, enabled: boolean) => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      const existing = prefs.find((p) => p.notification_type === type) || null;
      const needsTime = TYPES.find((t) => t.type === type)?.needsTime;
      const defaultTimeByType: Partial<Record<NotificationType, string>> = {
        bedtime_story: "20:00:00",
        workout_window: "12:00:00",
        journal_prompt: "20:30:00",
      };
      const send_time =
        enabled && needsTime && !existing?.send_time
          ? (defaultTimeByType[type] ?? null)
          : (existing?.send_time ?? null);
      await upsertPref.mutateAsync({
        notification_type: type,
        enabled,
        send_time,
      });
    } catch (e) {
      logError("[settings] upsertPref failed", e);
      toast({ description: "Unable to update notification right now. Please try again.", variant: "destructive" });
    }
  };

  const handleTimeChange = async (type: NotificationType, hhmm: string) => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      const existing = prefs.find((p) => p.notification_type === type) || null;
      await upsertPref.mutateAsync({
        notification_type: type,
        enabled: existing?.enabled ?? true,
        send_time: toPgTime(hhmm),
      });
    } catch (e) {
      logError("[settings] upsertPref time failed", e);
      toast({ description: "Unable to save time right now. Please try again.", variant: "destructive" });
    }
  };

  const handleTimezoneSave = async () => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      await updateProfile.mutateAsync({ timezone: browserTz });
      toast({ description: `Timezone saved: ${browserTz}` });
    } catch (e) {
      logError("[settings] timezone save failed", e);
      toast({ description: "Unable to save timezone right now. Please try again.", variant: "destructive" });
    }
  };

  return (
    <SitePageShell>
      <section className="bg-background border-b border-border">
        <div className="w-full px-5 lg:px-8 py-10">
          <span className="section-label !p-0 mb-4 block">SETTINGS</span>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Push notifications</h1>
          <p className="text-sm text-muted-foreground mt-2">
            All notifications are opt-in. Times are based on your dad timezone.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2 md:items-stretch">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <div className="font-heading font-bold">Enable push notifications</div>
                <div className="text-xs text-muted-foreground">
                  Required for all notification types.
                </div>
              </div>
              <Switch checked={pushEnabled} disabled={!user} onCheckedChange={handleMasterToggle} />
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-heading font-bold">Timezone</div>
                  <div className="text-xs text-muted-foreground">
                    Stored in <code className="text-xs">user_profile.timezone</code>. Current:{" "}
                    <span className="font-mono">{timezone || "—"}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTimezoneSave}
                  disabled={!user}
                  className="shrink-0 inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  Use browser timezone
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-3 lg:grid-cols-2">
            {prefsError && (
              <div className="lg:col-span-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                Notification preferences are temporarily unavailable. Please refresh and try again.
              </div>
            )}
            {TYPES.map((t) => {
              const row = prefs.find((p) => p.notification_type === t.type) || null;
              const enabled = Boolean(row?.enabled);
              const hhmm = toHHMM(row?.send_time);
              const disabled = !canEditPrefCards || !pushEnabled;

              return (
                <div key={t.type} className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-heading font-bold">{t.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">{t.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Opens: <span className="font-semibold">{t.linkLabel}</span>
                      </div>
                    </div>
                    <Switch
                      checked={enabled}
                      disabled={disabled}
                      onCheckedChange={(v) => handleTypeToggle(t.type, v)}
                    />
                  </div>

                  {t.needsTime && (
                    <div className="mt-3 flex items-center justify-between gap-4">
                      <div className="text-xs text-muted-foreground">{t.timeHint}</div>
                      <input
                        type="time"
                        value={hhmm}
                        disabled={disabled}
                        onChange={(e) => handleTimeChange(t.type, e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm font-mono"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!user && (
            <div className="mt-6 text-sm text-muted-foreground">
              Sign in to edit settings.
            </div>
          )}
        </div>
      </section>

      <section className="bg-background border-b border-border">
        <div className="w-full px-5 lg:px-8 py-10">
          <span className="section-label !p-0 mb-4 block">WEARABLES</span>
          <h2 className="font-heading text-2xl font-extrabold tracking-tight">Connected devices</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Garmin and Fitbit data can fill in steps, active minutes, sleep and resting heart rate.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {(["garmin", "fitbit"] as const).map((provider) => {
              const integration = integrations.find((item) => item.provider === provider);
              const connected = Boolean(integration);
              return (
                <div key={provider} className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-heading font-bold">{formatProvider(provider)}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {connected
                          ? `${integration?.device_name || formatProvider(provider)} connected`
                          : "No device connected"}
                      </div>
                      {connected && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Last sync: {formatSyncTime(integration?.last_sync_at)} via {formatProvider(provider)}
                        </div>
                      )}
                    </div>

                    {connected ? (
                      <button
                        type="button"
                        onClick={() => disconnectWearable.mutate(provider)}
                        disabled={disconnectWearable.isPending}
                        className="shrink-0 inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <a
                        href={user ? `/api/integrations/${provider}/connect` : "#"}
                        onClick={(event) => {
                          if (!user) {
                            event.preventDefault();
                            openAuthModal();
                          }
                        }}
                        className="shrink-0 inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold hover:bg-accent hover:text-accent-foreground"
                      >
                        Connect
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {integrationsError && (
            <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              Wearable connections are temporarily unavailable. Please refresh and try again.
            </div>
          )}
        </div>
      </section>
    </SitePageShell>
  );
}

