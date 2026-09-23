import type { Json } from "@/lib/supabase/types";
import { isRainCheck } from "@/lib/constants/completion";
import { addDays, getDayOfWeek, todayDateKey, toDateKey } from "./timezone";

/**
 * The slice of a `completions` row that scheduling and streak logic need.
 * Everything past `completed_at` is optional so a caller that only has dates
 * behaves exactly as it did before rain checks existed.
 */
export interface CompletionRow {
  completed_at: string;
  completion_type?: string | null;
  /** Only set on a rain check that was moved rather than simply skipped. */
  rain_check_moved_to?: string | null;
}

/**
 * Parsed representation of a habit's schedule JSONB column.
 * The DB stores `Json | null`; this interface narrows it after validation.
 */
export interface HabitSchedule {
  days?: number[];
}

/**
 * Parsed representation of a habit's time_window JSONB column.
 */
export interface HabitTimeWindow {
  start?: string;
  end?: string;
}

/**
 * Safely parse the `schedule` column (`Json | null`) into a typed object.
 * Returns `null` when the value is missing or not an object, and filters
 * out any non-numeric entries in `days` to guard against corrupt data.
 */
export function parseSchedule(value: Json | null | unknown): HabitSchedule | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (!("days" in record) || !Array.isArray(record.days)) {
    return {};
  }

  return { days: record.days.filter((d): d is number => typeof d === "number") };
}

/**
 * Returns the scheduled day numbers for a habit, falling back to every day
 * of the week when no specific days are configured.
 */
export function getScheduledDays(schedule: Json | null | unknown): number[] {
  const parsed = parseSchedule(schedule);
  return parsed?.days ?? [0, 1, 2, 3, 4, 5, 6];
}

/**
 * Safely parse the `time_window` column (`Json | null`) into a typed object.
 */
export function parseTimeWindow(value: Json | null | unknown): HabitTimeWindow | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const result: HabitTimeWindow = {};
  if (typeof record.start === "string") result.start = record.start;
  if (typeof record.end === "string") result.end = record.end;
  return result;
}

/**
 * Check whether a habit is scheduled on a given date in the user's timezone.
 * Treats habits with no schedule or an empty days array as daily (always scheduled).
 */
export function isHabitScheduledOn(
  habit: { schedule: unknown },
  day: Date,
  timezone: string,
): boolean {
  const parsed = parseSchedule(habit.schedule);
  if (!parsed?.days || parsed.days.length === 0) return true;
  return parsed.days.includes(getDayOfWeek(day, timezone));
}

/**
 * The day a rain check was moved *from*, if one of them promised to make this
 * habit up on `dateKey`. Returns a YYYY-MM-DD key, or null when this day holds
 * no makeup.
 *
 * This is what puts a habit on a day it isn't normally scheduled for: a
 * Mon/Wed/Fri habit rain-checked on Wednesday and moved to Thursday appears on
 * Thursday, and checking in there settles the Wednesday occurrence.
 */
export function makeupOriginOn(
  completions: CompletionRow[],
  dateKey: string,
  timezone: string,
): string | null {
  for (const c of completions) {
    if (!isRainCheck(c.completion_type)) continue;
    if (c.rain_check_moved_to !== dateKey) continue;
    return toDateKey(c.completed_at, timezone);
  }
  return null;
}

/**
 * Is this habit expected on this day — either because the day is in its
 * schedule, or because a rain check was moved onto it?
 *
 * `day` and `dayKey` must describe the same day; the pair is passed rather
 * than derived because turning a date key back into a `Date` cannot recover
 * the local weekday in every timezone.
 */
export function isHabitDueOn(
  habit: { schedule: unknown; completions: CompletionRow[] },
  day: Date,
  dayKey: string,
  timezone: string,
): boolean {
  return (
    isHabitScheduledOn(habit, day, timezone) ||
    makeupOriginOn(habit.completions, dayKey, timezone) !== null
  );
}

/**
 * The days a rain check taken today may be moved onto: days in the next
 * `withinDays` that the habit is **not** already scheduled for.
 *
 * A day the habit is due anyway already has its own occurrence. Moving onto
 * it would double-book the day, and worse, let work that was going to happen
 * regardless settle the skip — a free pass on the streak. So a habit that is
 * scheduled every day has nowhere to move to, and returns an empty list: it
 * can only be skipped.
 *
 * Weekdays are stepped arithmetically from today's rather than re-derived
 * from each date key, which cannot recover the local weekday in every zone.
 */
export function movableDayKeys(
  habit: { schedule: unknown },
  timezone: string,
  withinDays: number,
): string[] {
  const scheduled = parseSchedule(habit.schedule)?.days;
  // No schedule, or an empty day list, means daily — there is nowhere to move.
  if (!scheduled || scheduled.length === 0) return [];

  const todayKey = todayDateKey(timezone);
  const todayDow = getDayOfWeek(new Date(), timezone);

  const keys: string[] = [];
  for (let i = 1; i <= withinDays; i++) {
    if (scheduled.includes((todayDow + i) % 7)) continue;
    keys.push(addDays(todayKey, i));
  }
  return keys;
}
