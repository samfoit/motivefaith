import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

// Access NEXT_PUBLIC_* vars with dot notation so Turbopack/webpack
// can statically inline them into the client bundle.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  if (cached) return cached;
  cached = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: "pkce",
    },
  });
  return cached;
}
