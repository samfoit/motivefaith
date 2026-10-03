"use client";

import { useQuery, type QueryKey } from "@tanstack/react-query";
import type { DashboardData } from "@/lib/data/dashboard";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";

/**
 * Keyed by user so one person's habits can never be restored from IndexedDB
 * into another person's session. The persisted cache is additionally bucketed
 * by user via the `buster` in `src/components/providers.tsx`; this is the
 * in-memory half of the same guarantee.
 */
export function dashboardKey(userId: string | null): QueryKey {
  return ["dashboard", userId];
}

/** Matches every user's dashboard — for invalidation, not for reading. */
export const DASHBOARD_KEY_PREFIX = ["dashboard"] as const;

async function fetchDashboardJson(): Promise<DashboardData> {
  const response = await fetch("/api/dashboard", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Dashboard request failed: ${response.status}`);
  }
  return response.json();
}

export function useDashboard({
  holdRefetch = false,
}: {
  /**
   * Stop every automatic refetch (focus, mount, invalidation) while true.
   * The dashboard sets it while a check-in is written optimistically but not
   * yet confirmed: the server does not have it, so a refetch landing in that
   * gap would wipe it off screen until the write lands and the next refetch
   * puts it back. The cached data stays readable throughout.
   */
  holdRefetch?: boolean;
} = {}) {
  const userId = useAuthUserId();

  return useQuery({
    queryKey: dashboardKey(userId),
    queryFn: fetchDashboardJson,
    enabled: !!userId && !holdRefetch,
    // The habits list changes only when the user acts, and every such action
    // updates the cache optimistically — so a refetch is about picking up
    // changes made elsewhere (another device, the service worker's sync),
    // not about correctness here.
    staleTime: 60 * 1000,
  });
}
