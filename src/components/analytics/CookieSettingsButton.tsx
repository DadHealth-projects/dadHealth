"use client";

import { ANALYTICS_SETTINGS_EVENT } from "@/lib/analytics";

export default function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(ANALYTICS_SETTINGS_EVENT))}
    >
      Cookie Settings
    </button>
  );
}
