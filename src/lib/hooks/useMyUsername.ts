"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";

/**
 * The signed-in user's own username.
 *
 * The share card puts their invite link at its foot, so wherever a share
 * affordance lands it needs this. A prop would have been simpler, but the
 * dashboard cannot supply one: that document is deliberately user-agnostic so
 * the service worker can cache it and replay it to whoever opens the app next
 * (see the greeting in `dashboard-client.tsx`). Baking a username into it at
 * request time would be both stale and a leak.
 *
 * Fetched on the client instead, where the cache is per-session anyway. It
 * never changes within one, hence the infinite staleness; callers that already
 * hold it — the habit detail page reads it server-side — pass it as
 * `initialData` and make no request at all.
 */
export function useMyUsername(initial?: string | null) {
  const userId = useAuthUserId();
  const supabase = createClient();

  return useQuery({
    queryKey: ["my-username", userId],
    enabled: !!userId,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    ...(initial ? { initialData: initial } : {}),
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .single();
      if (error) throw error;
      return data?.username ?? null;
    },
  });
}
