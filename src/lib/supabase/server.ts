import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — cookie writes are only
            // allowed in Server Actions / Route Handlers. The middleware
            // handles token refresh, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Request-scoped cached auth check. React's `cache()` deduplicates
 * calls within a single server render pass, so layout.tsx + page.tsx
 * share a single network round-trip to Supabase Auth.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createServerSupabase();
  return supabase.auth.getUser();
});

/**
 * Request-scoped cached profile fetch. Deduplicates the profile query
 * across AuthGate (layout) and page components so only one DB round-trip
 * is made per render pass.
 */
export const getProfile = cache(async (userId: string) => {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, timezone, date_of_birth")
    .eq("id", userId)
    .single();
  return data;
});
