import type { Json } from "@/lib/supabase/types";
import { isRainCheck } from "@/lib/constants/completion";
import { DAYS, FREQUENCIES } from "@/lib/constants/habit";
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
 * One day's window: when the habit opens, and when it counts as missed. A
 * type rather than an interface, so a stored window is assignable to the
 * generated Json type.
 */
export type DayWindow = { start: string; end: string };

/**
 * Parsed representation of a habit's time_window JSONB column: the usual
 * window, and the days that differ from it (045). A day mapped to null has
 * no set time — no reminder, no missed alert, and it sits under Anytime.
 */
export interface HabitTimeWindow {
  start?: string;
  end?: string;
  /** Keyed by weekday, 0 = Sunday, as `schedule.days` is. */
  days?: Partial<Record<number, DayWindow | null>>;
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
 * Entries in `days` that are not a weekday, or neither a window nor null,
 * are dropped, as parseSchedule drops non-numeric days.
 */
export function parseTimeWindow(value: Json | null | unknown): HabitTimeWindow | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const result: HabitTimeWindow = {};
  if (typeof record.start === "string") result.start = record.start;
  if (typeof record.end === "string") result.end = record.end;

  const days = record.days;
  if (days != null && typeof days === "object" && !Array.isArray(days)) {
    const parsed: NonNullable<HabitTimeWindow["days"]> = {};
    for (const [key, entry] of Object.entries(days)) {
      if (!/^[0-6]$/.test(key)) continue;
      if (entry === null) parsed[Number(key)] = null;
      else if (isDayWindow(entry)) parsed[Number(key)] = { start: entry.start, end: entry.end };
    }
    if (Object.keys(parsed).length > 0) result.days = parsed;
  }

  return result;
}

function isDayWindow(value: unknown): value is DayWindow {
  if (value == null || typeof value !== "object") return false;
  const { start, end } = value as Record<string, unknown>;
  return typeof start === "string" && typeof end === "string";
}

/**
 * The usual window. The database has always let a window without a start or
 * an end through, so either may be blank here; formatStartTime reads a blank
 * as no time.
 */
function usualWindow(tw: HabitTimeWindow): DayWindow | null {
  if (!tw.start && !tw.end) return null;
  return { start: tw.start ?? "", end: tw.end ?? "" };
}

function sameWindow(a: DayWindow | null, b: DayWindow | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end;
}

/**
 * The window a habit keeps on one weekday (0 = Sunday): the day's own if it
 * has one, otherwise the usual. Null for no window that day — none at all, or
 * a day with no set time.
 */
export function windowOn(tw: HabitTimeWindow | null, weekday: number): DayWindow | null {
  if (!tw) return null;
  const own = tw.days?.[weekday];
  return own !== undefined ? own : usualWindow(tw);
}

/** Scheduled days that keep one window: null for no set time. */
export interface WindowGroup {
  days: number[];
  window: DayWindow | null;
}

/**
 * A habit's window as the days that share each time: the usual first, on
 * every scheduled day without a time of its own, then each different time in
 * the order of its first day. Days that keep the same time are one group
 * however they were entered, and a day whose own time is the usual one is
 * simply on the usual time. Empty for a habit with no window.
 */
export function timeWindowGroups(
  tw: HabitTimeWindow | null,
  scheduledDays: number[],
): WindowGroup[] {
  if (!tw) return [];
  const usual: WindowGroup = { days: [], window: usualWindow(tw) };
  const others: WindowGroup[] = [];
  for (const day of [...scheduledDays].sort((a, b) => a - b)) {
    const own = tw.days?.[day];
    if (own === undefined || sameWindow(own, usual.window)) {
      usual.days.push(day);
      continue;
    }
    const group = others.find((g) => sameWindow(g.window, own));
    if (group) group.days.push(day);
    else others.push({ days: [day], window: own });
  }
  return [usual, ...others];
}

/** The Repeat menu's named sets of days, so a group reads as the menu does. */
const NAMED_DAY_SETS = FREQUENCIES.flatMap((f) =>
  f.days && f.value !== "weekly" ? [{ label: f.label, days: f.days }] : [],
);

/**
 * A set of days as a person would say it: "Every day", "Weekdays",
 * "Weekends", or the days themselves — "Mon, Wed, Fri" — Sunday first, as
 * the day buttons are.
 */
export function describeDays(days: number[]): string {
  const set = new Set(days);
  const named = NAMED_DAY_SETS.find(
    (f) => f.days.length === set.size && f.days.every((d) => set.has(d)),
  );
  if (named) return named.label;
  return [...set]
    .sort((a, b) => a - b)
    .map((d) => DAYS[d].full.slice(0, 3))
    .join(", ");
}

/**
 * A time window's start as the habit card shows it: "9 AM", "9:30 PM".
 * Null for a value that is not "HH:MM".
 */
export function formatStartTime(start: string | null | undefined): string | null {
  if (!start) return null;
  const [h, m] = start.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** A window as the habit page shows it: "8 AM – 9 AM". */
export function formatWindow(w: DayWindow): string {
  return `${formatStartTime(w.start) ?? "–"} – ${formatStartTime(w.end) ?? "–"}`;
}

// ---------------------------------------------------------------------------
// The habit form's time fields
// ---------------------------------------------------------------------------

/** The window a new habit's time fields start on. */
export const DEFAULT_TIME_WINDOW: DayWindow = { start: "09:00", end: "12:00" };

/** One different time in the habit form: the days it is for, and their time. */
export interface TimeException {
  /** Stable across edits, for React keys. */
  id: string;
  days: number[];
  /** False for "Any time": these days have no set time. */
  timed: boolean;
  /** Kept while `timed` is off, so turning it back on restores them. */
  start: string;
  end: string;
}

/** The form fields a habit's window is made from. */
export interface TimeWindowFields {
  frequency: string;
  scheduleDays: number[];
  timeWindowEnabled: boolean;
  timeWindowStart: string;
  timeWindowEnd: string;
  timeWindowExceptions: TimeException[];
}

/** time_window as this build writes it: always with its days, {} for none. */
export type StoredTimeWindow = DayWindow & { days: Record<string, DayWindow | null> };

/**
 * The exceptions the form shows. None on a weekly habit, which is done once,
 * on any day. None whose days have all left the schedule: those stay in the
 * form, and come back if the days do. One the user has emptied stays, asking
 * for a day.
 */
export function shownExceptions(fields: TimeWindowFields): TimeException[] {
  if (fields.frequency === "weekly") return [];
  const scheduled = new Set(fields.scheduleDays);
  return fields.timeWindowExceptions.filter(
    (e) => e.days.length === 0 || e.days.some((d) => scheduled.has(d)),
  );
}

/** The scheduled days on the usual time: those no shown exception has taken. */
export function usualDays(fields: TimeWindowFields): number[] {
  const taken = new Set(shownExceptions(fields).flatMap((e) => e.days));
  return fields.scheduleDays.filter((d) => !taken.has(d)).sort((a, b) => a - b);
}

/**
 * The days a new exception starts with, from those still on the usual time:
 * the weekend, when they include weekend days and weekdays both — a
 * different time at the weekend is the one most people want — and otherwise
 * the last of them. The usual time keeps at least one day.
 */
export function newExceptionDays(usual: number[]): number[] {
  const weekend = usual.filter((d) => d === 0 || d === 6);
  if (weekend.length > 0 && weekend.length < usual.length) return weekend;
  return usual.slice(-1);
}

/**
 * The time fields with the usual time kept on at least one day. The day
 * buttons never take its last day, so only a change to Repeat can leave it
 * on none. Then the first exception with a time becomes the usual time, and
 * its days keep what they were set to. With no exception that has a time,
 * every day is "Any time", which is no window at all.
 */
export function settleTimeFields<T extends TimeWindowFields>(fields: T): T {
  if (!fields.timeWindowEnabled || fields.scheduleDays.length === 0) return fields;
  if (usualDays(fields).length > 0) return fields;

  const scheduled = new Set(fields.scheduleDays);
  const first = shownExceptions(fields).find(
    (e) => e.timed && e.days.some((d) => scheduled.has(d)),
  );
  if (!first) return { ...fields, timeWindowEnabled: false };
  return {
    ...fields,
    timeWindowStart: first.start,
    timeWindowEnd: first.end,
    timeWindowExceptions: fields.timeWindowExceptions.filter((e) => e !== first),
  };
}

/**
 * Whether every window the form would store ends after it starts. A habit's
 * day is the calendar day, so a window may not run past midnight: one from
 * 6 PM to 10 AM was missed at 11 AM, against a window that opened only that
 * evening. The picker points out a window that does; this keeps it unsaved.
 */
export function timeWindowsInOrder(fields: TimeWindowFields): boolean {
  const settled = settleTimeFields(fields);
  if (!settled.timeWindowEnabled) return true;
  if (settled.timeWindowEnd <= settled.timeWindowStart) return false;
  const scheduled = new Set(settled.scheduleDays);
  return shownExceptions(settled).every(
    (e) => !e.timed || !e.days.some((d) => scheduled.has(d)) || e.end > e.start,
  );
}

/**
 * What the form's time fields store in time_window: null with the window
 * off, otherwise the usual window and the days that differ. The days are
 * always sent, {} for none — the database keeps the stored days when a write
 * leaves them out, as a build from before them does (045).
 *
 * Only scheduled days keep a time, the first exception to claim a day keeps
 * it, an exception with the usual time is no exception, and a weekly habit
 * has none.
 */
export function buildTimeWindow(fields: TimeWindowFields): StoredTimeWindow | null {
  const settled = settleTimeFields(fields);
  if (!settled.timeWindowEnabled) return null;

  const usual = { start: settled.timeWindowStart, end: settled.timeWindowEnd };
  const scheduled = new Set(settled.scheduleDays);
  const days: Record<string, DayWindow | null> = {};
  for (const e of shownExceptions(settled)) {
    const window = e.timed ? { start: e.start, end: e.end } : null;
    if (sameWindow(window, usual)) continue;
    for (const day of e.days) {
      if (scheduled.has(day) && !(day in days)) days[day] = window;
    }
  }
  return { ...usual, days };
}

/**
 * The form's time fields for a stored window: the usual time, and an
 * exception for each group of days that keep a different one.
 */
export function timeFieldsFromWindow(
  value: Json | null | unknown,
  scheduleDays: number[],
): Omit<TimeWindowFields, "frequency" | "scheduleDays"> {
  const tw = parseTimeWindow(value);
  if (!tw?.start && !tw?.end) {
    return {
      timeWindowEnabled: false,
      timeWindowStart: DEFAULT_TIME_WINDOW.start,
      timeWindowEnd: DEFAULT_TIME_WINDOW.end,
      timeWindowExceptions: [],
    };
  }

  const start = tw.start ?? DEFAULT_TIME_WINDOW.start;
  const end = tw.end ?? DEFAULT_TIME_WINDOW.end;
  const [, ...others] = timeWindowGroups(tw, scheduleDays);
  return {
    timeWindowEnabled: true,
    timeWindowStart: start,
    timeWindowEnd: end,
    timeWindowExceptions: others.map((g) => ({
      id: crypto.randomUUID(),
      days: g.days,
      timed: g.window !== null,
      start: g.window?.start ?? start,
      end: g.window?.end ?? end,
    })),
  };
}

/**
 * One change to a habit's schedule, as habit_schedule_changes (049) keeps it:
 * the owner's day the new schedule took effect, and the schedule before it.
 * The day of the change and every day after are judged by the newer one.
 */
export interface ScheduleChange {
  changed_on: string;
  frequency: string;
  /** schedule.days as it was: null, or no days, for every day. */
  days: Json | null;
}

/**
 * The schedule a habit kept on a day: the one the first change after that
 * day replaced, or the habit's own. Mirrors the lookup in
 * habit_last_due_day() (049) — keep the two in step.
 */
export function scheduleOn(
  habit: { frequency?: string | null; schedule: unknown },
  changes: readonly ScheduleChange[],
  dayKey: string,
): { frequency: string | null; schedule: unknown; until: string | null } {
  let first: ScheduleChange | null = null;
  for (const c of changes) {
    if (c.changed_on > dayKey && (first === null || c.changed_on < first.changed_on)) {
      first = c;
    }
  }
  if (!first) {
    return { frequency: habit.frequency ?? null, schedule: habit.schedule, until: null };
  }
  return { frequency: first.frequency, schedule: { days: first.days }, until: first.changed_on };
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
