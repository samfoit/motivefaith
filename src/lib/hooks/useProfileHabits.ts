"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
import {
  toProfileHabit,
  type ProfileHabit,
  type ProfileHabitRpcRow,
} from "@/lib/types/partners";

export const PROFILE_HABITS_KEY = ["profile-habits"];

export function profileHabitsKey(userId: string | null) {
  return [...PROFILE_HABITS_KEY, userId];
}

/**
 * A friend's habits, as far as you are allowed to see them.
 *
 * Fetched when the sheet opens rather than with the page: it is behind a tap,
 * and the friends list would otherwise fire one of these per row.
 */
export function useProfileHabits(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: profileHabitsKey(userId),
    enabled: !!userId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ProfileHabit[]> => {
      if (!userId) return [];
      const supabase = createClient();
      const { data, error } = await untypedRpc<ProfileHabitRpcRow[]>(
        supabase,
        "get_profile_habits",
        { p_user_id: userId },
      );
      if (error) {
        console.error("get_profile_habits error:", error.message);
        return [];
      }
      return (data ?? []).map(toProfileHabit);
    },
  });
}
