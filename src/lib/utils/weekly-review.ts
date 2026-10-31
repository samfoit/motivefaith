import type { Database, Json } from "@/lib/supabase/types";
import { addDays } from "./timezone";

/**
 * A week as saved by save_weekly_review() (migration 051), or counted so far
 * by get_current_week_review(). Weeks run Sunday to Saturday in the owner's
 * timezone; `week_start` is the Sunday.
 */
export type WeeklyReview = Database["public"]["Tables"]["weekly_reviews"]["Row"];

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function parts(dateKey: string) {
  const d = new Date(dateKey + "T12:00:00Z");
  return { month: MONTH.format(d), day: d.getUTCDate(), year: d.getUTCFullYear() };
}

/** Whether a string is a YYYY-MM-DD key for a real Sunday. */
export function isWeekStart(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && d.getUTCDay() === 0;
}

/** The Sunday-to-Saturday week's seven date keys. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * "Oct 18 – 24", "Sep 27 – Oct 3". The year is added when it is not
 * `currentYear`, and to both ends when the week spans two.
 */
export function weekRangeLabel(weekStart: string, currentYear: number): string {
  const a = parts(weekStart);
  const b = parts(addDays(weekStart, 6));
  if (a.year !== b.year) {
    return `${a.month} ${a.day}, ${a.year} – ${b.month} ${b.day}, ${b.year}`;
  }
  const range = a.month === b.month ? `${a.month} ${a.day} – ${b.day}` : `${a.month} ${a.day} – ${b.month} ${b.day}`;
  return a.year === currentYear ? range : `${range}, ${a.year}`;
}

/** Days done of days due, as a whole percent; null when nothing was due. */
export function weekRate(week: Pick<WeeklyReview, "due" | "done">): number | null {
  return week.due > 0 ? Math.round((week.done / week.due) * 100) : null;
}

/** daily_completions as a map of date key to check-ins. */
export function dailyCounts(value: Json): Record<string, number> {
  const counts: Record<string, number> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [day, n] of Object.entries(value)) {
      if (typeof n === "number") counts[day] = n;
    }
  }
  return counts;
}

/** What a day was for a habit: habit_day_status() in migration 051. */
export type DayStatus =
  | "done"
  | "done_week"
  | "extra"
  | "missed"
  | "pending"
  | "open"
  | "excused"
  | "paused"
  | "off"
  | "upcoming";

const DAY_STATUSES = new Set<string>([
  "done", "done_week", "extra", "missed", "pending", "open", "excused", "paused", "off", "upcoming",
]);

/** A habit on one day of a review, as the `days` column keeps it. */
export interface DayHabit {
  habitId: string;
  title: string;
  emoji: string | null;
  weekly: boolean;
  status: DayStatus;
  /** Check-in times that day, "HH:MM" in the owner's timezone. */
  times: string[];
  /** A rain check's reason, on the day it was taken. */
  reason: string | null;
}

/** One day's habits out of the `days` column; none for a day it lacks. */
export function dayHabits(days: Json, day: string): DayHabit[] {
  if (!days || typeof days !== "object" || Array.isArray(days)) return [];
  const list = days[day];
  if (!Array.isArray(list)) return [];
  const habits: DayHabit[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { habit_id, title, emoji, weekly, status, times, reason } = entry;
    if (typeof habit_id !== "string" || typeof title !== "string") continue;
    if (typeof status !== "string" || !DAY_STATUSES.has(status)) continue;
    habits.push({
      habitId: habit_id,
      title,
      emoji: typeof emoji === "string" ? emoji : null,
      weekly: weekly === true,
      status: status as DayStatus,
      times: Array.isArray(times) ? times.filter((t): t is string => typeof t === "string") : [],
      reason: typeof reason === "string" ? reason : null,
    });
  }
  return habits;
}

/**
 * A day's habits sorted into what was done, what was not, what a rain check
 * or a pause excused, and what was not due. A weekly habit done on another
 * day of the week is kept apart: that day it was neither done nor missed.
 */
export function groupDay(habits: DayHabit[]) {
  const groups = {
    done: [] as DayHabit[],
    notDone: [] as DayHabit[],
    excused: [] as DayHabit[],
    notDue: [] as DayHabit[],
    doneThisWeek: [] as DayHabit[],
  };
  for (const h of habits) {
    switch (h.status) {
      case "done":
      case "extra":
        groups.done.push(h);
        break;
      case "done_week":
        groups.doneThisWeek.push(h);
        break;
      case "missed":
      case "pending":
      case "open":
        groups.notDone.push(h);
        break;
      case "excused":
      case "paused":
        groups.excused.push(h);
        break;
      case "off":
        groups.notDue.push(h);
        break;
    }
  }
  return groups;
}
