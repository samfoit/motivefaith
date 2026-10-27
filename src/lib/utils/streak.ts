import { toDateKey, todayDateKey, subtractDays, addDays, getDayOfWeek } from "./timezone";
import { parseSchedule, type CompletionRow } from "./schedule";
import { pauseStartOn, type HabitPause } from "./pauses";
import { isRainCheck } from "@/lib/constants/completion";

/** The Sunday a day's week starts on — the week update_streak() counts in. */
function weekStartOf(dayKey: string): string {
  return subtractDays(dayKey, new Date(dayKey + "T12:00:00Z").getUTCDay());
}

/**
 * The Sunday of the last week before `weekStart` that a weekly habit was held
 * to: one whose Saturday was not paused. Mirrors habit_last_counted_week() in
 * migration 047 — keep the two in step.
 */
function lastCountedWeek(pauses: readonly HabitPause[], weekStart: string): string {
  let week = subtractDays(weekStart, 7);
  let pauseStart = pauseStartOn(pauses, addDays(week, 6));
  while (pauseStart !== null) {
    // That Saturday was paused, and so was every one back to the week the
    // pause began in.
    week = subtractDays(weekStartOf(pauseStart), 7);
    pauseStart = pauseStartOn(pauses, addDays(week, 6));
  }
  return week;
}

/**
 * Would a check-in made now move the streak?
 *
 * Only the first real check-in of the day does — of the week, for a weekly
 * habit. Doing a habit again the same day is still recorded, still shared and
 * still adds to its total, but the day is already in the streak. Mirrors the
 * already_counted guard in update_streak() (027), which is what decides; this
 * keeps the optimistic streak and the milestone toast in step with it. A rain
 * check is not a check-in, so one earlier today leaves the next one counting.
 */
export function countsTowardStreak(
  habit: { frequency?: string | null },
  completions: CompletionRow[],
  timeZone: string,
): boolean {
  const today = todayDateKey(timeZone);
  const since = habit.frequency === "weekly" ? weekStartOf(today) : today;
  return !completions.some(
    (c) =>
      !isRainCheck(c.completion_type) &&
      toDateKey(c.completed_at, timeZone) >= since,
  );
}

/**
 * Validates whether a habit's DB streak is still active by checking if the
 * most recent scheduled day has a completion. The DB trigger only updates
 * streak_current on INSERT, so stale values persist when habits are missed.
 *
 * All date comparisons use the user's IANA timezone so that "today" and
 * "yesterday" match what the user sees in the UI.
 *
 * Paused days are stepped over, the way habit_last_due_day() and
 * habit_last_counted_week() (047) step over them on the server: a pause
 * keeps the streak, however long it ran.
 */
export function computeEffectiveStreak(
  habit: { streak_current: number | null; schedule: unknown; frequency?: string | null },
  completions: CompletionRow[],
  timeZone: string,
  {
    pauses = [],
    loadedFrom,
  }: {
    /** The habit's pauses, from habit_pauses. */
    pauses?: readonly HabitPause[];
    /**
     * The first day `completions` holds in full, if they start somewhere.
     * Only a long pause sends the streak back past it, to a day that can't
     * be checked from here; the server's number is kept for that.
     */
    loadedFrom?: string;
  } = {},
): number {
  const dbStreak = habit.streak_current ?? 0;
  if (dbStreak === 0) return 0;

  const today = todayDateKey(timeZone);

  // Two collections rather than one: a rain check no longer unconditionally
  // covers its day, so real completions have to be distinguishable.
  const realDateKeys = new Set<string>();
  // Every rain check on a day is kept, because is_habit_day_covered() asks
  // whether *any* row covers it — so one plain skip is enough even if another
  // row on that day was moved and then broken.
  const rainChecks = new Map<string, (string | null)[]>();
  for (const c of completions) {
    const key = toDateKey(c.completed_at, timeZone);
    if (isRainCheck(c.completion_type)) {
      const movedTo = c.rain_check_moved_to ?? null;
      const existing = rainChecks.get(key);
      if (existing) existing.push(movedTo);
      else rainChecks.set(key, [movedTo]);
    } else {
      realDateKeys.add(key);
    }
  }

  /**
   * Is this day settled? Mirrors is_habit_day_covered() in migration 027 —
   * keep the two in step.
   *
   * A plain rain check covers its day forever. A rain check that was moved
   * covers it only while the promise is pending, or once it has been kept:
   * let the moved-to day pass undone and the chain snaps.
   */
  const coversDay = (key: string): boolean => {
    if (realDateKeys.has(key)) return true;
    const moves = rainChecks.get(key);
    if (!moves) return false;
    return moves.some(
      (movedTo) =>
        movedTo === null || movedTo >= today || realDateKeys.has(movedTo),
    );
  };

  // If today is settled, the streak is valid for any frequency
  if (coversDay(today)) return dbStreak;

  // Not settled as far as `completions` show — unless they don't reach it.
  const unseen = (key: string) => loadedFrom !== undefined && key < loadedFrom;

  // ── Weekly frequency: streak valid if a covered day in current or previous week ──
  if (habit.frequency === "weekly") {
    // The previous week it was held to: last week, unless that was paused.
    const prevWeekStartKey = lastCountedWeek(pauses, weekStartOf(today));

    for (const dk of realDateKeys) {
      if (dk >= prevWeekStartKey) return dbStreak;
    }
    for (const dk of rainChecks.keys()) {
      if (dk >= prevWeekStartKey && coversDay(dk)) return dbStreak;
    }
    return unseen(prevWeekStartKey) ? dbStreak : 0;
  }

  // ── Daily-type frequencies: walk backward skipping non-scheduled and paused days ──
  // Mirrors habit_last_due_day() in migration 047 — keep the two in step.
  const scheduledDays = parseSchedule(habit.schedule)?.days;

  // Walk backwards from yesterday to find the most recent scheduled day
  let checkKey = subtractDays(today, 1);

  for (let i = 0; i < 14; i++) {
    // A pause is stepped over whole, however long it ran.
    let pauseStart = pauseStartOn(pauses, checkKey);
    while (pauseStart !== null) {
      checkKey = subtractDays(pauseStart, 1);
      pauseStart = pauseStartOn(pauses, checkKey);
    }

    const dow = getDayOfWeek(new Date(checkKey + "T12:00:00Z"), timeZone);
    const isScheduled =
      !scheduledDays ||
      scheduledDays.length === 0 ||
      scheduledDays.includes(dow);

    if (isScheduled) {
      // Found the most recent scheduled day — was it settled?
      if (coversDay(checkKey)) return dbStreak;
      return unseen(checkKey) ? dbStreak : 0;
    }

    checkKey = subtractDays(checkKey, 1);
  }

  // No scheduled day found in the last 2 weeks — streak is stale
  return 0;
}
