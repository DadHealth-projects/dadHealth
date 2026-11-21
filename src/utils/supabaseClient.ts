import { analyticsPersistenceFetch } from '@/lib/analytics';
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

function readSupabaseBrowserEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const baseUrl = url?.replace(/\/+$/, "");
  if (!baseUrl || !key) {
    throw new Error(
      "Application configuration error: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return { url: baseUrl, key };
}

export function createClient(): SupabaseClient {
  const { url, key } = readSupabaseBrowserEnv();
  return createBrowserClient(url, key, {global:{fetch:analyticsPersistenceFetch}});
}

let browserClient: SupabaseClient | undefined;

function getBrowserClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient();
  }
  return browserClient;
}

/** Lazy singleton so importing this module does not require env at build/prerender time. */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getBrowserClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
