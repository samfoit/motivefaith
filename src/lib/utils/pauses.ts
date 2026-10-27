import { addDays, subtractDays } from "./timezone";

/**
 * One stretch a habit was paused for, as habit_pauses (047) keeps it: the
 * first day paused, and the first day back — null while it still is. Both
 * are day keys in the owner's timezone, and the day back is not paused.
 */
export interface HabitPause {
  started_on: string;
  ended_on: string | null;
}

/**
 * The first day of the pause covering a day, or null if none does. Mirrors
 * habit_pause_start() in migration 047 — keep the two in step.
 */
export function pauseStartOn(
  pauses: readonly HabitPause[],
  dayKey: string,
): string | null {
  let start: string | null = null;
  for (const p of pauses) {
    const covers =
      p.started_on <= dayKey && (p.ended_on === null || dayKey < p.ended_on);
    if (covers && (start === null || p.started_on < start)) {
      start = p.started_on;
    }
  }
  return start;
}

export function isPausedOn(
  pauses: readonly HabitPause[],
  dayKey: string,
): boolean {
  return pauseStartOn(pauses, dayKey) !== null;
}

/**
 * Days from `fromKey` to `toKey`, both included, that were paused — leaving
 * out any in `skip`, which the caller has accounted for another way.
 */
export function countPausedDays(
  pauses: readonly HabitPause[],
  fromKey: string,
  toKey: string,
  skip: ReadonlySet<string> = new Set(),
): number {
  const paused = new Set<string>();
  for (const p of pauses) {
    const first = p.started_on > fromKey ? p.started_on : fromKey;
    const lastPaused = p.ended_on === null ? toKey : subtractDays(p.ended_on, 1);
    const last = lastPaused < toKey ? lastPaused : toKey;
    for (let day = first; day <= last; day = addDays(day, 1)) {
      if (!skip.has(day)) paused.add(day);
    }
  }
  return paused.size;
}
