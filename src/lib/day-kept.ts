/**
 * Whether today is kept: every habit on it done, or excused by a rain check.
 *
 * Read from the dashboard's cached data, which every check-in on this device
 * is written to (the dashboard's own, the habit page's and the camera's), so
 * the answer is the same wherever the last one was made — and the same one
 * the Day view's bar gives.
 */

import type { DashboardData } from "@/lib/data/dashboard";
import { isRainCheck } from "@/lib/constants/completion";
import { isHabitDueOn } from "@/lib/utils/schedule";
import { toDateKey } from "@/lib/utils/timezone";

/** A habit on today: checked in, excused by a rain check, or still to do. */
export type DayHabitState = "done" | "rain" | "open";

export interface DayProgress {
  /**
   * Today's habits, as the Day view lists them: scheduled today, or moved
   * onto it by an earlier rain check. A real check-in outranks a rain check.
   */
  habits: { id: string; state: DayHabitState }[];
  done: number;
  rainChecked: number;
  /**
   * Nothing left open, and at least one habit actually done. A rain check
   * settles its habit without shame, but a day of nothing but rain checks was
   * set aside, not kept.
   */
  kept: boolean;
}

export function dayProgress(
  data: DashboardData | undefined,
  now: Date = new Date(),
): DayProgress {
  if (!data) return { habits: [], done: 0, rainChecked: 0, kept: false };
  const { timezone } = data;
  const todayKey = toDateKey(now, timezone);

  const habits = data.habits
    .filter((habit) => isHabitDueOn(habit, now, todayKey, timezone))
    .map((habit) => {
      let state: DayHabitState = "open";
      for (const c of habit.completions) {
        if (toDateKey(c.completed_at, timezone) !== todayKey) continue;
        if (!isRainCheck(c.completion_type)) {
          state = "done";
          break;
        }
        state = "rain";
      }
      return { id: habit.id, state };
    });

  const done = habits.filter((h) => h.state === "done").length;
  const rainChecked = habits.filter((h) => h.state === "rain").length;
  return {
    habits,
    done,
    rainChecked,
    kept: done > 0 && done + rainChecked === habits.length,
  };
}

/** What the day looked like at the moment it was kept. */
export interface DayKept {
  /**
   * One per habit on today, in the order to light them: those already
   * settled first, then the ones this check-in settled.
   */
  flames: { id: string; state: "done" | "rain"; fresh: boolean }[];
  done: number;
  rainChecked: number;
}

/**
 * The day as kept by one change to the dashboard's data — or null when the
 * change didn't keep it: something is still open, or it was kept already.
 * Doing a habit again on a kept day, or checking in one that was
 * rain-checked, changes nothing here.
 */
export function keptBy(
  before: DashboardData | undefined,
  after: DashboardData | undefined,
  now: Date = new Date(),
): DayKept | null {
  const next = dayProgress(after, now);
  if (!next.kept) return null;
  const prev = dayProgress(before, now);
  if (prev.kept) return null;
  const was = new Map(prev.habits.map((h) => [h.id, h.state]));
  return dayKept(next, (h) => was.get(h.id) !== h.state);
}

/**
 * A kept day's flames: the habits `isFresh` picks out are the ones the
 * check-in just settled, and are lit last.
 */
export function dayKept(
  progress: DayProgress,
  isFresh: (habit: { id: string; state: DayHabitState }) => boolean,
): DayKept {
  const flames = progress.habits
    .filter(
      (h): h is { id: string; state: "done" | "rain" } => h.state !== "open",
    )
    .map((h) => ({ ...h, fresh: isFresh(h) }));
  return {
    flames: [...flames.filter((f) => !f.fresh), ...flames.filter((f) => f.fresh)],
    done: progress.done,
    rainChecked: progress.rainChecked,
  };
}

/** The line under the headline: what the day came to, in plain words. */
export function dayKeptSummary({ done, rainChecked }: Pick<DayKept, "done" | "rainChecked">): string {
  if (rainChecked > 0) {
    return `${done} done, ${rainChecked} rain-checked.`;
  }
  if (done === 1) return "Your habit for today, done.";
  if (done === 2) return "Both habits, done.";
  return `All ${done} habits, done.`;
}
