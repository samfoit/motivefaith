import { toDateKey } from "@/lib/utils/timezone";
import { isHabitDueOn } from "@/lib/utils/schedule";
import { isPausedOn } from "@/lib/utils/pauses";
import { isRainCheck } from "@/lib/constants/completion";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";

/**
 * What one habit did on one day — shared by the week and month views so the
 * two can never disagree about it.
 *
 * "off" (not scheduled, paused, or before the habit existed) is kept apart
 * from "missed": a Mon/Wed/Fri habit should not look missed every Tuesday,
 * nor a resumed one every day it was paused.
 */
export type DayState = "done" | "rain" | "missed" | "today" | "upcoming" | "off";

export interface HabitDayIndex {
  /** Logged days. A real check-in outranks a rain check on the same day. */
  byDay: Map<string, "done" | "rain">;
  createdKey: string | null;
}

export function indexHabitDays(
  habit: HabitWithCompletions,
  timezone: string,
): HabitDayIndex {
  const byDay = new Map<string, "done" | "rain">();
  for (const c of habit.completions) {
    const key = toDateKey(c.completed_at, timezone);
    if (!isRainCheck(c.completion_type)) byDay.set(key, "done");
    else if (!byDay.has(key)) byDay.set(key, "rain");
  }
  return {
    byDay,
    createdKey: habit.created_at ? toDateKey(habit.created_at, timezone) : null,
  };
}

/** `date` and `key` must describe the same day (see `isHabitDueOn`). */
export function habitDayState(
  habit: HabitWithCompletions,
  index: HabitDayIndex,
  date: Date,
  key: string,
  todayKey: string,
  timezone: string,
): DayState {
  const logged = index.byDay.get(key);
  if (logged) return logged;
  if (index.createdKey && key < index.createdKey) return "off";
  if (isPausedOn(habit.pauses ?? [], key)) return "off";
  if (!isHabitDueOn(habit, date, key, timezone)) return "off";
  if (key === todayKey) return "today";
  return key < todayKey ? "missed" : "upcoming";
}
