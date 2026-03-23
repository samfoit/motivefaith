"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getBrowserTimezone, toDateKey } from "@/lib/utils/timezone";
import { getScheduledDays } from "@/lib/utils/schedule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeeklySummaryData {
  totalCompletions: number;
  totalScheduled: number;
  completionRate: number;
  bestStreak: number;
  mostConsistentHabit: {
    title: string;
    emoji: string;
    count: number;
  } | null;
  prevWeekCompletions: number;
  weekDelta: number;
  encouragementsSent: number;
  encouragementsReceived: number;
  /** Map of ISO date (YYYY-MM-DD) to completion count — for heatmap */
  dailyCompletions: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWeekBounds() {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const thisEnd = now.toISOString();

  const thisStartDate = new Date(now);
  thisStartDate.setDate(thisStartDate.getDate() - 6);
  thisStartDate.setHours(0, 0, 0, 0);
  const thisStart = thisStartDate.toISOString();

  const prevEndDate = new Date(thisStartDate);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  prevEndDate.setHours(23, 59, 59, 999);
  const prevEnd = prevEndDate.toISOString();

  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - 6);
  prevStartDate.setHours(0, 0, 0, 0);
  const prevStart = prevStartDate.toISOString();

  return { thisStart, thisEnd, prevStart, prevEnd };
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchWeeklySummary(
  userId: string,
): Promise<WeeklySummaryData> {
  const supabase = createClient();
  const { thisStart, thisEnd, prevStart, prevEnd } = getWeekBounds();

  // Parallel queries — check each result for errors since Supabase
  // returns { data, error } without throwing.
  const [completionsResult, prevCountResult, habitsResult, sentResult, receivedResult] =
    await Promise.all([
      supabase
        .from("completions")
        .select("id, habit_id, completed_at")
        .eq("user_id", userId)
        .gte("completed_at", thisStart)
        .lte("completed_at", thisEnd),
      supabase
        .from("completions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("completed_at", prevStart)
        .lte("completed_at", prevEnd),
      supabase
        .from("habits")
        .select("id, title, emoji, schedule, streak_current")
        .eq("user_id", userId)
        .eq("is_paused", false),
      supabase
        .from("encouragements")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", thisStart)
        .lte("created_at", thisEnd),
      supabase
        .from("encouragements")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .gte("created_at", thisStart)
        .lte("created_at", thisEnd),
    ]);

  if (completionsResult.error) throw completionsResult.error;
  if (habitsResult.error) throw habitsResult.error;

  const thisWeekCompletions = completionsResult.data;
  const prevWeekCount = prevCountResult.count;
  const habits = habitsResult.data;
  const encouragementsSent = sentResult.count;
  const encouragementsReceived = receivedResult.count;

  // Calculate scheduled count for the week
  let totalScheduled = 0;
  for (const habit of habits ?? []) {
    totalScheduled += getScheduledDays(habit.schedule).length;
  }

  const completions = thisWeekCompletions ?? [];
  const totalCompletions = completions.length;
  const completionRate =
    totalScheduled > 0 ? (totalCompletions / totalScheduled) * 100 : 0;

  // Most consistent habit
  const habitCounts = new Map<string, number>();
  for (const c of completions) {
    habitCounts.set(c.habit_id, (habitCounts.get(c.habit_id) ?? 0) + 1);
  }

  let mostConsistentHabit: WeeklySummaryData["mostConsistentHabit"] = null;
  let maxCount = 0;
  for (const [habitId, count] of habitCounts) {
    if (count > maxCount) {
      maxCount = count;
      const habit = (habits ?? []).find((h) => h.id === habitId);
      if (habit) {
        mostConsistentHabit = { title: habit.title, emoji: habit.emoji ?? "✅", count };
      }
    }
  }

  // Best streak
  const bestStreak = Math.max(
    0,
    ...(habits ?? []).map((h) => h.streak_current ?? 0),
  );

  // Daily completions map for heatmap (keyed by user's timezone date)
  const tz = getBrowserTimezone();
  const dailyCompletions: Record<string, number> = {};
  for (const c of completions) {
    if (!c.completed_at) continue;
    const day = toDateKey(c.completed_at, tz);
    dailyCompletions[day] = (dailyCompletions[day] ?? 0) + 1;
  }

  const prevWeekCompletions = prevWeekCount ?? 0;

  return {
    totalCompletions,
    totalScheduled,
    completionRate,
    bestStreak,
    mostConsistentHabit,
    prevWeekCompletions,
    weekDelta: totalCompletions - prevWeekCompletions,
    encouragementsSent: encouragementsSent ?? 0,
    encouragementsReceived: encouragementsReceived ?? 0,
    dailyCompletions,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWeeklySummary(userId: string | null) {
  return useQuery({
    queryKey: ["weekly-summary", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    queryFn: () => fetchWeeklySummary(userId!),
  });
}
