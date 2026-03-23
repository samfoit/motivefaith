import { toDateKey, todayDateKey, subtractDays, getDayOfWeek } from "./timezone";
import { parseSchedule } from "./schedule";

/**
 * Validates whether a habit's DB streak is still active by checking if the
 * most recent scheduled day has a completion. The DB trigger only updates
 * streak_current on INSERT, so stale values persist when habits are missed.
 *
 * All date comparisons use the user's IANA timezone so that "today" and
 * "yesterday" match what the user sees in the UI.
 */
export function computeEffectiveStreak(
  habit: { streak_current: number | null; schedule: unknown },
  completions: { completed_at: string }[],
  timeZone: string,
): number {
  const dbStreak = habit.streak_current ?? 0;
  if (dbStreak === 0 || completions.length === 0) return 0;

  const scheduledDays = parseSchedule(habit.schedule)?.days;

  const today = todayDateKey(timeZone);
  const completionDateKeys = new Set(
    completions.map((c) => toDateKey(c.completed_at, timeZone)),
  );

  // If completed today, streak is definitely valid
  if (completionDateKeys.has(today)) return dbStreak;

  // Walk backwards from yesterday to find the most recent scheduled day
  let checkKey = subtractDays(today, 1);

  for (let i = 0; i < 14; i++) {
    const dow = getDayOfWeek(new Date(checkKey + "T12:00:00Z"), timeZone);
    const isScheduled =
      !scheduledDays ||
      scheduledDays.length === 0 ||
      scheduledDays.includes(dow);

    if (isScheduled) {
      // Found the most recent scheduled day — was it completed?
      return completionDateKeys.has(checkKey) ? dbStreak : 0;
    }

    checkKey = subtractDays(checkKey, 1);
  }

  // No scheduled day found in the last 2 weeks — streak is stale
  return 0;
}
