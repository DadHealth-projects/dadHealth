import { createClient } from "@supabase/supabase-js";

export const HAPPENING_IMAGE_BUCKET = "happening-images";
export const MAX_LIVE_HAPPENINGS = 3;

export const HAPPENING_SELECT =
  "id,title,event_at,summary,image_url,button_label,button_url,show_until,active,created_at,updated_at";

export interface HomepageHappening {
  id: string;
  title: string;
  event_at: string;
  summary: string;
  image_url: string | null;
  button_label: string | null;
  button_url: string | null;
  show_until: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HappeningWrite {
  title: string;
  event_at: string;
  summary: string;
  image_url: string | null;
  button_label: string | null;
  button_url: string | null;
  show_until: string;
  active: boolean;
}

type ParseResult =
  | { ok: true; value: HappeningWrite }
  | { ok: false; error: string };

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

function httpUrl(value: string): boolean {
  try {
    return HTTP_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function happeningImagePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!supabaseUrl) return null;

  try {
    const image = new URL(value);
    const base = new URL(supabaseUrl);
    const prefix = `/storage/v1/object/public/${HAPPENING_IMAGE_BUCKET}/`;
    if (image.origin !== base.origin || !image.pathname.startsWith(prefix)) return null;

    const path = decodeURIComponent(image.pathname.slice(prefix.length));
    return /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(path) ? path : null;
  } catch {
    return null;
  }
}

export function parseHappeningWrite(input: unknown): ParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Happening details are required." };
  }

  const record = input as Record<string, unknown>;
  const allowed = new Set([
    "title",
    "event_at",
    "summary",
    "image_url",
    "button_label",
    "button_url",
    "show_until",
    "active",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return { ok: false, error: "Unexpected Happening field." };
  }

  const title = requiredText(record.title, 120);
  if (!title) return { ok: false, error: "Title is required and must be 120 characters or fewer." };

  const summary = requiredText(record.summary, 240);
  if (!summary) return { ok: false, error: "One-line summary is required and must be 240 characters or fewer." };

  const eventAt = isoDate(record.event_at);
  if (!eventAt) return { ok: false, error: "A valid event date and time with timezone is required." };

  const showUntil = isoDate(record.show_until);
  if (!showUntil) return { ok: false, error: "A valid show-until date and time with timezone is required." };

  const imageUrl = optionalText(record.image_url, 2048);
  if (imageUrl === undefined || (imageUrl && !happeningImagePath(imageUrl))) {
    return { ok: false, error: "Image must come from the Happening image uploader." };
  }

  const buttonLabel = optionalText(record.button_label, 50);
  const buttonUrl = optionalText(record.button_url, 2048);
  if (buttonLabel === undefined || buttonUrl === undefined || Boolean(buttonLabel) !== Boolean(buttonUrl)) {
    return { ok: false, error: "Button label and link must be supplied together." };
  }
  if (buttonUrl && !httpUrl(buttonUrl)) {
    return { ok: false, error: "Button link must be a valid HTTP or HTTPS URL." };
  }

  if (record.active != null && typeof record.active !== "boolean") {
    return { ok: false, error: "Active state must be true or false." };
  }
  const active = typeof record.active === "boolean" ? record.active : true;

  return {
    ok: true,
    value: {
      title,
      event_at: eventAt,
      summary,
      image_url: imageUrl,
      button_label: buttonLabel,
      button_url: buttonUrl,
      show_until: showUntil,
      active,
    },
  };
}

export async function getLiveHappenings(now = new Date()): Promise<HomepageHappening[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  const { data, error } = await supabase
    .from("homepage_happenings")
    .select(HAPPENING_SELECT)
    .eq("active", true)
    .gt("show_until", now.toISOString())
    .order("event_at", { ascending: true })
    .limit(MAX_LIVE_HAPPENINGS);

  if (error) {
    console.error("[homepage happenings]", error);
    return [];
  }
  return (data ?? []) as HomepageHappening[];
}
