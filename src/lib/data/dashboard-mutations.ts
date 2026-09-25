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
 * A rain check holds the streak exactly where it is: it accounts for the day
 * without advancing the count, so it can never cross a milestone either.
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
          streak_current: rainCheck
            ? (habit.streak_current ?? 0)
            : (habit.streak_current ?? 0) + 1,
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
        created_at: new Date().toISOString(),
        completions: [],
        challenge: null,
      } as DashboardData["habits"][number],
    ],
  };
}
