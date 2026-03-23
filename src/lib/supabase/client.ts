import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

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
