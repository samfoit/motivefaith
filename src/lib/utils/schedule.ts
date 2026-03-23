import type { Json } from "@/lib/supabase/types";
import { getDayOfWeek } from "./timezone";

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
