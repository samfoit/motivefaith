"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { fetchLateHabits } from "@/lib/data/late-habits";
import { useDismissedLateHabits } from "@/lib/stores/late-habit-dismissals";
import { lateHabitKey, type LateHabit } from "@/lib/types/late-habits";

export const LATE_HABITS_KEY = ["late-habits"];

export function lateHabitsKey(userId: string | null) {
  return [...LATE_HABITS_KEY, userId];
}

/**
 * Every friend's habits waiting on a word from this user: the inbox's list,
 * the same rows their chats' cards show (`get_chat_late_habits` with no chat
 * named, migration 053).
 *
 * One query serves the inbox and the TopBar badge. A chat invalidates it when
 * you send a message there, since that answers what had gone late.
 */
export function useLateHabits(
  userId: string | null,
  options?: { initialData?: LateHabit[] },
) {
  return useQuery({
    queryKey: lateHabitsKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    initialData: options?.initialData,
    queryFn: async (): Promise<LateHabit[]> =>
      userId ? fetchLateHabits(createClient()) : [],
  });
}

/** The badge's share: the inbox's list less what was dismissed here. */
export function useLateHabitCount(userId: string | null): number {
  const { data = [] } = useLateHabits(userId);
  const dismissed = useDismissedLateHabits();
  return data.filter((habit) => !dismissed?.has(lateHabitKey(habit))).length;
}
