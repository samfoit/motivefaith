/**
 * Pure updates to the cached dashboard.
 *
 * These live outside the component for two reasons. First, the optimistic
 * update has to be applied to the *React Query cache* rather than to component
 * state: the cache is persisted to IndexedDB, so a completion logged offline
 * still shows after a reload instead of vanishing from the UI while sitting
 * unsent in the outbox. Second, the streak rules below were previously inlined
 * twice in `dashboard-client.tsx` — in `handleCompletion` and again in
 * `handleQuickComplete` — where they could drift apart unnoticed.
 */

import type { DashboardData } from "@/lib/data/dashboard";
import type { Database } from "@/lib/supabase/types";
import { isRainCheck, type CompletionType } from "@/lib/constants/completion";
import { countsTowardStreak } from "@/lib/utils/streak";
import { getScheduledDays, type ScheduleChange } from "@/lib/utils/schedule";
import { todayDateKey } from "@/lib/utils/timezone";

export interface OptimisticCompletion {
  habitId: string;
  /** Client-side id, so the same entry can be removed again on undo. */
  tempId: string;
  type: CompletionType;
  /** A YYYY-MM-DD key when a rain check was moved to another day. */
  rainCheckMovedTo?: string;
}

/**
 * Add a completion to the cached habit.
 *
 * Only the day's first real check-in advances the streak. A rain check holds
 * it exactly where it is, and so does doing the habit again the same day: both
 * are recorded, but neither moves the count or can cross a milestone.
 */
export function applyCompletion(
  data: DashboardData | undefined,
  { habitId, tempId, type, rainCheckMovedTo }: OptimisticCompletion,
): DashboardData | undefined {
  if (!data) return data;
  const rainCheck = isRainCheck(type);

  return {
    ...data,
    habits: data.habits.map((habit) =>
      habit.id === habitId
        ? {
          ...habit,
          completions: [
            ...habit.completions,
            {
              id: tempId,
              completed_at: new Date().toISOString(),
              completion_type: type,
              rain_check_moved_to: rainCheckMovedTo ?? null,
            },
          ],
          streak_current:
            !rainCheck &&
            countsTowardStreak(habit, habit.completions, data.timezone)
              ? (habit.streak_current ?? 0) + 1
              : (habit.streak_current ?? 0),
        }
        : habit,
    ),
  };
}

/**
 * Remove an optimistic completion — the user pressed Undo, or the write
 * failed. `streak` is the value from before the completion was applied, rather
 * than a decrement, so an undo cannot drift the streak if the habit was
 * refetched in between.
 */
export function removeCompletion(
  data: DashboardData | undefined,
  { habitId, tempId, streak }: { habitId: string; tempId: string; streak: number },
): DashboardData | undefined {
  if (!data) return data;

  return {
    ...data,
    habits: data.habits.map((habit) =>
      habit.id === habitId
        ? {
          ...habit,
          completions: habit.completions.filter((c) => c.id !== tempId),
          streak_current: streak,
        }
        : habit,
    ),
  };
}

/**
 * Show a habit that has been created but not yet sent.
 *
 * Without this, a habit created offline would not appear until the outbox
 * drained — the user would fill in the form, land on the dashboard, and find
 * nothing there. The fields the database would have defaulted are filled in
 * here so the card renders identically to a synced one; the row is replaced
 * wholesale by the server's copy on the next successful fetch.
 */
export function applyHabitCreate(
  data: DashboardData | undefined,
  habit: {
    id: string;
    user_id: string;
    title: string;
    description: string | null;
    emoji: string;
    color: string | null;
    frequency: string;
    schedule: unknown;
    time_window: unknown;
    visibility: Database["public"]["Enums"]["habit_visibility"];
  },
): DashboardData | undefined {
  if (!data) return data;
  if (data.habits.some((h) => h.id === habit.id)) return data; // already there

  return {
    ...data,
    habits: [
      ...data.habits,
      {
        ...habit,
        streak_current: 0,
        streak_best: 0,
        total_completions: 0,
        is_paused: false,
        private_checkins: false,
        created_at: new Date().toISOString(),
        completions: [],
        pauses: [],
        challenge: null,
      } as DashboardData["habits"][number],
    ],
  };
}

/**
 * Apply an edit to a cached habit — title, color, schedule and so on. Without
 * this the dashboard kept showing the old values after a save: the edit sheet
 * lives on the habit page, whose `router.refresh()` never touches this cache.
 *
 * A new schedule is kept as a change from today, as the database keeps it
 * (049), so the days before go on showing the schedule they had — offline
 * too, until the refetch brings the real row.
 */
export function applyHabitUpdate(
  data: DashboardData | undefined,
  habitId: string,
  patch: Partial<DashboardData["habits"][number]>,
): DashboardData | undefined {
  if (!data) return data;

  return {
    ...data,
    habits: data.habits.map((habit) => {
      if (habit.id !== habitId) return habit;
      const updated = { ...habit, ...patch };
      if (!scheduleChanged(habit, updated)) return updated;

      const today = todayDateKey(data.timezone);
      const changes = habit.schedule_changes ?? [];
      // A second change the same day keeps the first one's schedule before.
      if (changes.some((c) => c.changed_on === today)) return updated;
      const change: ScheduleChange = {
        changed_on: today,
        frequency: habit.frequency,
        days: getScheduledDays(habit.schedule),
      };
      return { ...updated, schedule_changes: [...changes, change] };
    }),
  };
}

function scheduleChanged(
  before: { frequency: string; schedule: unknown },
  after: { frequency: string; schedule: unknown },
): boolean {
  if (before.frequency !== after.frequency) return true;
  const a = new Set(getScheduledDays(before.schedule));
  const b = getScheduledDays(after.schedule);
  return a.size !== new Set(b).size || b.some((d) => !a.has(d));
}

/**
 * Take a habit off the dashboard — it was deleted, or paused (paused habits are
 * not shown there).
 */
export function removeHabit(
  data: DashboardData | undefined,
  habitId: string,
): DashboardData | undefined {
  if (!data) return data;

  return {
    ...data,
    habits: data.habits.filter((habit) => habit.id !== habitId),
  };
}
