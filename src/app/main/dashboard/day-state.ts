import { addDays, subtractDays, toDateKey } from "@/lib/utils/timezone";
import { isHabitDueOn, scheduleOn } from "@/lib/utils/schedule";
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

  // The schedule the day had: one changed since judges it no differently.
  const kept = scheduleOn(habit, habit.schedule_changes ?? [], key);
  if (kept.frequency === "weekly") return weeklyDayState(index, key, todayKey);

  if (!isHabitDueOn({ ...habit, schedule: kept.schedule }, date, key, timezone)) {
    return "off";
  }
  if (key === todayKey) return "today";
  return key < todayKey ? "missed" : "upcoming";
}

/**
 * A weekly habit is done once, any day of its week, Sunday to Saturday. Once
 * the week has a check-in or a rain check, its other days are off. A week
 * that ends without one is missed on its Saturday, where its partners hear
 * of it; the days before stay off. Until then today is open, and the days
 * after it still to come.
 */
function weeklyDayState(index: HabitDayIndex, key: string, todayKey: string): DayState {
  const weekStart = subtractDays(key, new Date(key + "T12:00:00Z").getUTCDay());
  for (let i = 0; i < 7; i++) {
    if (index.byDay.has(addDays(weekStart, i))) return "off";
  }
  if (key === todayKey) return "today";
  if (key > todayKey) return "upcoming";
  return key === addDays(weekStart, 6) ? "missed" : "off";
}
