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
  /**
   * Days each habit was done on, summed: what the rate counts. A habit done
   * twice in a day is two completions but one of its scheduled days.
   */
  habitDaysDone: number;
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

/**
 * What the week's rate counts: the days each habit was scheduled, and the
 * days it was done on. A weekly habit is due once a week, whatever its days
 * say, and done once however many days it was done on.
 */
export function weekRateCounts(
  habits: { id: string; frequency?: string | null; schedule: unknown }[],
  completions: { habit_id: string; completed_at: string | null }[],
  timeZone: string,
): { totalScheduled: number; habitDaysDone: number } {
  const weekly = new Set(habits.filter((h) => h.frequency === "weekly").map((h) => h.id));

  let totalScheduled = 0;
  for (const habit of habits) {
    totalScheduled += weekly.has(habit.id) ? 1 : getScheduledDays(habit.schedule).length;
  }

  const habitDaysDone = new Set(
    completions.flatMap((c) => {
      if (!c.completed_at) return [];
      return [weekly.has(c.habit_id) ? c.habit_id : `${c.habit_id}:${toDateKey(c.completed_at, timeZone)}`];
    }),
  ).size;

  return { totalScheduled, habitDaysDone };
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
        .select("id, title, emoji, frequency, schedule, streak_current")
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

  // Days are keyed in the user's timezone, as the heatmap below keys them.
  const tz = getBrowserTimezone();

  const completions = thisWeekCompletions ?? [];
  const totalCompletions = completions.length;
  const { totalScheduled, habitDaysDone } = weekRateCounts(habits ?? [], completions, tz);
  const completionRate =
    totalScheduled > 0 ? (habitDaysDone / totalScheduled) * 100 : 0;

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
  const dailyCompletions: Record<string, number> = {};
  for (const c of completions) {
    if (!c.completed_at) continue;
    const day = toDateKey(c.completed_at, tz);
    dailyCompletions[day] = (dailyCompletions[day] ?? 0) + 1;
  }

  const prevWeekCompletions = prevWeekCount ?? 0;

  return {
    totalCompletions,
    habitDaysDone,
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
