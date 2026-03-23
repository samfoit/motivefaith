"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getBrowserTimezone, todayDateKey } from "@/lib/utils/timezone";

/**
 * Returns the count of missed habits from friends today.
 * Used by the TopBar bell badge.
 *
 * Uses a single RPC call (`get_missed_habit_count`) instead of
 * 3 sequential queries for habit_shares → habits → completions.
 */
export function useMissedHabitCount(userId: string | null) {
  return useQuery({
    queryKey: ["missed-habits-count", userId],
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    queryFn: async (): Promise<number> => {
      if (!userId) return 0;
      const supabase = createClient();
      const tz = getBrowserTimezone();

      const { data, error } = await supabase.rpc("get_missed_habit_count", {
        p_timezone: tz,
      });

      if (error) {
        console.error("get_missed_habit_count error:", error);
        return 0;
      }

      const count = data ?? 0;

      // Subtract habits the user has dismissed today (sessionStorage — clears on tab close)
      if (typeof window !== "undefined") {
        try {
          const todayStr = todayDateKey(tz);
          const key = `dismissed-inbox-${todayStr}`;
          const stored = sessionStorage.getItem(key);
          if (stored) {
            const parsed: unknown = JSON.parse(stored);
            const dismissedCount = Array.isArray(parsed) ? parsed.length : 0;
            return Math.max(0, count - dismissedCount);
          }
        } catch { /* ignore */ }
      }

      return count;
    },
  });
}
