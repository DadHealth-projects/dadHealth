"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SitePageShell from "@/components/SitePageShell";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/utils/supabaseClient";

type WearableProvider = "garmin" | "fitbit";

type WearableIntegration = {
  provider: WearableProvider;
  device_name: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
};

type CallbackFeedback = {
  kind: "success" | "error";
  message: string;
} | null;

const providers: WearableProvider[] = ["garmin", "fitbit"];

function providerName(provider: WearableProvider) {
  return provider === "fitbit" ? "Fitbit" : "Garmin";
}

function formatSyncTime(value: string | null | undefined) {
  if (!value) return "Not synced yet";
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function readCallbackFeedback(): CallbackFeedback {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("connected");
  if (connected === "garmin" || connected === "fitbit") {
    return {
      kind: "success",
      message: `${providerName(connected)} connected successfully.`,
    };
  }

  const error = params.get("error");
  if (!error) return null;
  if (error === "auth_required") {
    return { kind: "error", message: "Sign in, then try connecting your wearable again." };
  }

  return {
    kind: "error",
    message: "We could not complete the wearable connection. Please try again.",
  };
}

export default function SettingsPageContent() {
  const { user, loading: authLoading, openAuthModal } = useAuth();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<CallbackFeedback>(null);

  useEffect(() => {
    setFeedback(readCallbackFeedback());
  }, []);

  const { data: integrations = [], error: integrationsError, isLoading } = useQuery({
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
    mutationFn: async (provider: WearableProvider) => {
      const response = await fetch(`/api/integrations/${provider}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to disconnect wearable");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["wearable-integrations", user?.id] });
      await queryClient.invalidateQueries({ queryKey: ["progress", user?.id] });
      toast({ description: "Wearable disconnected." });
    },
    onError: () => {
      toast({
        description: "Unable to disconnect wearable right now.",
        variant: "destructive",
      });
    },
  });

  return (
    <SitePageShell>
      <section className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <p className="section-label !p-0">Account settings</p>
        <h1 className="mt-4 font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
          Connected services
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Manage Garmin and Fitbit connections used by your Dad Health account.
        </p>

        {feedback && (
          <div
            role="status"
            className={`mt-6 border px-4 py-3 text-sm ${
              feedback.kind === "success"
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
          >
            {feedback.message}
          </div>
        )}

        {!authLoading && !user ? (
          <div className="mt-10 border border-border bg-card p-6 sm:p-8">
            <h2 className="font-heading text-2xl font-extrabold uppercase">Sign in required</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Sign in to view or manage connected services.
            </p>
            <button
              type="button"
              onClick={openAuthModal}
              className="mt-6 inline-flex min-h-11 items-center bg-primary px-5 font-heading text-sm font-extrabold uppercase tracking-wider text-primary-foreground"
            >
              Sign in
            </button>
          </div>
        ) : user ? (
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {providers.map((provider) => {
              const integration = integrations.find((item) => item.provider === provider);
              const connected = Boolean(integration);

              return (
                <article key={provider} className="border border-border bg-card p-5">
                  <div className="flex min-h-32 flex-col">
                    <h2 className="font-heading text-xl font-extrabold uppercase">
                      {providerName(provider)}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {isLoading
                        ? "Checking connection..."
                        : connected
                          ? `${integration?.device_name || providerName(provider)} connected`
                          : "No device connected"}
                    </p>
                    {connected && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last sync: {formatSyncTime(integration?.last_sync_at)}
                      </p>
                    )}

                    <div className="mt-auto pt-6">
                      {connected ? (
                        <button
                          type="button"
                          onClick={() => disconnectWearable.mutate(provider)}
                          disabled={disconnectWearable.isPending}
                          className="inline-flex min-h-11 items-center border border-border px-4 font-heading text-xs font-bold uppercase tracking-wider text-foreground disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      ) : (
                        <a
                          href={`/api/integrations/${provider}/connect`}
                          className="inline-flex min-h-11 items-center bg-primary px-4 font-heading text-xs font-bold uppercase tracking-wider text-primary-foreground"
                        >
                          Connect
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-10 text-sm text-muted-foreground">Checking account...</p>
        )}

        {user && integrationsError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            Connected services are temporarily unavailable. Please try again.
          </p>
        )}

        <div className="mt-10 border-t border-border pt-8">
          <h2 className="font-heading text-2xl font-extrabold uppercase">Subscription</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            View your Pro status or manage a web subscription on the billing page.
          </p>
          <Link
            href="/pricing"
            className="mt-5 inline-flex min-h-11 items-center border border-primary px-4 font-heading text-xs font-bold uppercase tracking-wider text-primary"
          >
            Manage subscription
          </Link>
        </div>
      </section>
    </SitePageShell>
  );
}
