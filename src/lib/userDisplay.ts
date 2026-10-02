import type { User } from "@supabase/supabase-js";

export type ProfileDisplay = { display_name?: string | null } | null | undefined;

/** Neutral label when no name is available (avoid hardcoded product copy as a person name). */
export const DEFAULT_DISPLAY_FALLBACK = "Member";

/** Dashboard greeting when we filter out email-style handles (product voice for Dad Health). */
export const DASHBOARD_GREETING_FALLBACK = "Dad";

/**
 * Display name for UI: prefers `user_profile.display_name`, then auth metadata, then email local-part.
 */
export function resolveDisplayName(profile: ProfileDisplay, user: User | null | undefined): string {
  const fromProfile = profile?.display_name?.trim();
  if (fromProfile) return fromProfile;
  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const fromMeta =
    (typeof meta?.display_name === "string" && meta.display_name.trim()) ||
    (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
    "";
  if (fromMeta) return fromMeta;
  const local = user?.email?.split("@")[0]?.trim();
  if (local) return local;
  return DEFAULT_DISPLAY_FALLBACK;
}
/** First character (handles surrogate pairs). */
function firstChar(s: string): string {
  const g = [...s];
  return g[0] ?? "";
}

function initialsFromEmailLocal(email: string): string | null {
  const local = email.split("@")[0]?.trim() ?? "";
  if (!local) return null;
  const letters = local.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  if (letters.length === 1) return (letters[0] + letters[0]).toUpperCase();
  return null;
}

/**
 * Two-letter avatar from a display name; falls back to email local part; last resort "DH".
 */
export function initialsFromDisplayName(displayName: string, email?: string | null): string {
  const d = displayName.trim();
  if (d && d !== DEFAULT_DISPLAY_FALLBACK && d !== DASHBOARD_GREETING_FALLBACK) {
    const parts = d.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = firstChar(parts[0]);
      const b = firstChar(parts[1]);
      if (a && b) return (a + b).toUpperCase();
    }
    const compact = d.replace(/\s+/g, "");
    if (compact.length >= 2) {
      return (firstChar(compact) + ([...compact][1] ?? "")).toUpperCase();
    }
    if (compact.length === 1) {
      return (compact[0] + compact[0]).toUpperCase();
    }
  }
  if (email?.includes("@")) {
    const fromLocal = initialsFromEmailLocal(email);
    if (fromLocal) return fromLocal;
  }
  return "?";
}
