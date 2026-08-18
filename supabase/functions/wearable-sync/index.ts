import { createClient } from "@supabase/supabase-js";

type Provider = "garmin" | "fitbit";

type Integration = {
  id: string;
  user_id: string;
  provider: Provider;
  access_token: string;
  refresh_token: string;
};

type DailyMetrics = {
  steps?: number | null;
  activeMinutes?: number | null;
  restingHeartRate?: number | null;
  sleepHours?: number | null;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const syncDate = getSyncDate(req);
  const { data: integrations, error } = await supabase
    .from("user_integrations")
    .select("id,user_id,provider,access_token,refresh_token")
    .in("provider", ["garmin", "fitbit"]);

  if (error) {
    console.error("[wearable-sync] integration query failed", error);
    return json({ error: "Unable to load integrations" }, 500);
  }

  const results = [];

  for (const integration of integrations ?? []) {
    const result = await syncIntegration(integration as Integration, syncDate);
    results.push(result);
  }

  return json({ date: syncDate, results });
});

async function syncIntegration(integration: Integration, date: string) {
  try {
    let accessToken = await decryptToken(integration.access_token);
    const refreshToken = await decryptToken(integration.refresh_token);

    let metrics = await fetchProviderMetrics(integration.provider, accessToken, date);
    if (metrics.status === 401) {
      const refreshed = await refreshAccessToken(integration.provider, refreshToken);
      if (!refreshed) {
        throw new Error("Token refresh failed");
      }

      accessToken = refreshed.accessToken;
      await supabase
        .from("user_integrations")
        .update({
          access_token: await encryptToken(refreshed.accessToken),
          refresh_token: await encryptToken(refreshed.refreshToken || refreshToken),
        })
        .eq("id", integration.id);

      metrics = await fetchProviderMetrics(integration.provider, accessToken, date);
    }

    if (!metrics.ok) {
      throw new Error(`${integration.provider} returned ${metrics.status}`);
    }

    await upsertMetrics(integration, date, metrics.data);

    await supabase
      .from("user_integrations")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", integration.id);

    return { integration_id: integration.id, provider: integration.provider, ok: true };
  } catch (error) {
    console.error("[wearable-sync] integration failed", {
      integration_id: integration.id,
      provider: integration.provider,
      error,
    });
    return {
      integration_id: integration.id,
      provider: integration.provider,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function fetchProviderMetrics(provider: Provider, token: string, date: string) {
  return provider === "fitbit"
    ? fetchFitbitMetrics(token, date)
    : fetchGarminMetrics(token, date);
}

async function fetchFitbitMetrics(token: string, date: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const [activityRes, sleepRes] = await Promise.all([
    fetch(`https://api.fitbit.com/1/user/-/activities/date/${date}.json`, { headers }),
    fetch(`https://api.fitbit.com/1.2/user/-/sleep/date/${date}.json`, { headers }),
  ]);

  if (activityRes.status === 401 || sleepRes.status === 401) {
    return { ok: false, status: 401, data: {} as DailyMetrics };
  }

  if (!activityRes.ok || !sleepRes.ok) {
    return {
      ok: false,
      status: activityRes.ok ? sleepRes.status : activityRes.status,
      data: {} as DailyMetrics,
    };
  }

  const activity = await activityRes.json();
  const sleep = await sleepRes.json();
  const summary = activity.summary ?? {};
  const activeMinutes =
    toNumber(summary.fairlyActiveMinutes) +
    toNumber(summary.veryActiveMinutes) +
    toNumber(summary.lightlyActiveMinutes);

  return {
    ok: true,
    status: 200,
    data: {
      steps: nullableNumber(summary.steps),
      activeMinutes,
      restingHeartRate: nullableNumber(summary.restingHeartRate),
      sleepHours: minutesToHours(nullableNumber(sleep.summary?.totalMinutesAsleep)),
    },
  };
}

async function fetchGarminMetrics(token: string, date: string) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const baseUrl =
    Deno.env.get("GARMIN_DAILY_SUMMARY_URL") ||
    "https://apis.garmin.com/wellness-api/rest/dailies";

  const dayStart = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
  const dayEnd = dayStart + 86400 - 1;
  const url = new URL(baseUrl);
  url.searchParams.set("uploadStartTimeInSeconds", String(dayStart));
  url.searchParams.set("uploadEndTimeInSeconds", String(dayEnd));

  const dailyRes = await fetch(url, { headers });
  if (dailyRes.status === 401) return { ok: false, status: 401, data: {} as DailyMetrics };
  if (!dailyRes.ok) return { ok: false, status: dailyRes.status, data: {} as DailyMetrics };

  const payload = await dailyRes.json();
  const daily = Array.isArray(payload) ? payload[0] : payload.dailies?.[0] ?? payload.dailySummaries?.[0] ?? payload;
  const sleep = daily.sleep ?? daily.sleepSummary ?? {};

  return {
    ok: true,
    status: 200,
    data: {
      steps: nullableNumber(daily.steps ?? daily.totalSteps),
      activeMinutes: minutesFromSeconds(daily.activeTimeInSeconds ?? daily.durationInSeconds),
      restingHeartRate: nullableNumber(daily.restingHeartRateInBeatsPerMinute ?? daily.restingHeartRate),
      sleepHours: minutesToHours(
        nullableNumber(sleep.totalSleepTimeInSeconds) == null
          ? nullableNumber(sleep.totalMinutesAsleep)
          : nullableNumber(sleep.totalSleepTimeInSeconds)! / 60
      ),
    },
  };
}

async function upsertMetrics(integration: Integration, date: string, metrics: DailyMetrics) {
  const recordedAt = `${date}T00:00:00Z`;
  const rows = [
    metricRow(integration, "steps", metrics.steps, recordedAt),
    metricRow(integration, "active_mins", metrics.activeMinutes, recordedAt),
    metricRow(integration, "resting_hr", metrics.restingHeartRate, recordedAt),
  ].filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("body_metrics")
      .upsert(rows, { onConflict: "user_id,metric_type,recorded_at" });
    if (error) throw error;
  }

  if (metrics.sleepHours != null && metrics.sleepHours > 0) {
    const { error } = await supabase.from("sleep_logs").upsert(
      {
        user_id: integration.user_id,
        date,
        hours: metrics.sleepHours,
        source: integration.provider,
      },
      { onConflict: "user_id,date" }
    );
    if (error) throw error;
  }
}

function metricRow(integration: Integration, metricType: string, value: number | null | undefined, recordedAt: string) {
  if (value == null || !Number.isFinite(value)) return null;
  return {
    user_id: integration.user_id,
    metric_type: metricType,
    value,
    recorded_at: recordedAt,
    source: integration.provider,
  };
}

async function refreshAccessToken(provider: Provider, refreshToken: string) {
  const clientId = Deno.env.get(provider === "fitbit" ? "FITBIT_CLIENT_ID" : "GARMIN_CLIENT_ID");
  const clientSecret = Deno.env.get(provider === "fitbit" ? "FITBIT_CLIENT_SECRET" : "GARMIN_CLIENT_SECRET");
  const tokenUrl =
    provider === "fitbit"
      ? "https://api.fitbit.com/oauth2/token"
      : Deno.env.get("GARMIN_TOKEN_URL") || "https://api.garmin.com/oauth2/token";

  if (!clientId || !clientSecret) return null;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string | undefined) || refreshToken,
  };
}

function getSyncDate(req: Request) {
  const override = new URL(req.url).searchParams.get("date");
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

function isAuthorized(req: Request) {
  const secret = Deno.env.get("WEARABLE_SYNC_SECRET");
  if (!secret) return true;

  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function nullableNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toNumber(value: unknown) {
  return nullableNumber(value) ?? 0;
}

function minutesToHours(minutes: number | null | undefined) {
  return minutes == null ? null : Math.round((minutes / 60) * 10) / 10;
}

function minutesFromSeconds(seconds: unknown) {
  const value = nullableNumber(seconds);
  return value == null ? null : Math.round(value / 60);
}

async function encryptToken(token: string) {
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return ["v1", encodeBase64Url(iv), encodeBase64Url(new Uint8Array(encrypted))].join(".");
}

async function decryptToken(value: string) {
  if (!value.startsWith("v1.")) return value;

  const parts = value.split(".");
  const key = await getCryptoKey();

  if (parts.length === 4) {
    const [, iv, tag, ciphertext] = parts;
    const combined = concatBytes(decodeBase64Url(ciphertext), decodeBase64Url(tag));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(iv) },
      key,
      combined
    );
    return new TextDecoder().decode(decrypted);
  }

  const [, iv, ciphertext] = parts;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(iv) },
    key,
    decodeBase64Url(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

async function getCryptoKey() {
  const secret =
    Deno.env.get("WEARABLE_TOKEN_ENCRYPTION_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Missing token encryption key");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function concatBytes(a: Uint8Array, b: Uint8Array) {
  const output = new Uint8Array(a.length + b.length);
  output.set(a, 0);
  output.set(b, a.length);
  return output;
}
