import { toDateKey, todayDateKey, subtractDays, getDayOfWeek } from "./timezone";
import { parseSchedule, type CompletionRow } from "./schedule";
import { isRainCheck } from "@/lib/constants/completion";

/**
 * Validates whether a habit's DB streak is still active by checking if the
 * most recent scheduled day has a completion. The DB trigger only updates
 * streak_current on INSERT, so stale values persist when habits are missed.
 *
 * All date comparisons use the user's IANA timezone so that "today" and
 * "yesterday" match what the user sees in the UI.
 */
export function computeEffectiveStreak(
  habit: { streak_current: number | null; schedule: unknown; frequency?: string | null },
  completions: CompletionRow[],
  timeZone: string,
): number {
  const dbStreak = habit.streak_current ?? 0;
  if (dbStreak === 0 || completions.length === 0) return 0;

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

  // ── Weekly frequency: streak valid if a covered day in current or previous week ──
  if (habit.frequency === "weekly") {
    const todayDate = new Date(today + "T12:00:00Z");
    const dow = todayDate.getUTCDay(); // 0=Sun
    const weekStartKey = subtractDays(today, dow);
    const prevWeekStartKey = subtractDays(weekStartKey, 7);

    for (const dk of realDateKeys) {
      if (dk >= prevWeekStartKey) return dbStreak;
    }
    for (const dk of rainChecks.keys()) {
      if (dk >= prevWeekStartKey && coversDay(dk)) return dbStreak;
    }
    return 0;
  }

  // ── Daily-type frequencies: walk backward skipping non-scheduled days ──
  const scheduledDays = parseSchedule(habit.schedule)?.days;

  // Walk backwards from yesterday to find the most recent scheduled day
  let checkKey = subtractDays(today, 1);

  for (let i = 0; i < 14; i++) {
    const dow = getDayOfWeek(new Date(checkKey + "T12:00:00Z"), timeZone);
    const isScheduled =
      !scheduledDays ||
      scheduledDays.length === 0 ||
      scheduledDays.includes(dow);

    if (isScheduled) {
      // Found the most recent scheduled day — was it settled?
      return coversDay(checkKey) ? dbStreak : 0;
    }

    checkKey = subtractDays(checkKey, 1);
  }

  // No scheduled day found in the last 2 weeks — streak is stale
  return 0;
}
