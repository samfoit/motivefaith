import { formatStartTime } from "@/lib/utils/schedule";
import { weekdayName } from "@/lib/utils/timezone";
import type { LateHabit } from "@/lib/types/late-habits";

/** A date as YYYY-MM-DD in this device's calendar. */
function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "today", "yesterday", else "on Saturday": a YYYY-MM-DD date seen from now. */
function relativeDay(dateKey: string, now: Date): string {
  if (dateKey === localDateKey(now)) return "today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dateKey === localDateKey(yesterday)) return "yesterday";
  return `on ${weekdayName(dateKey)}`;
}

/** "10 AM", "9:30 AM": the app's own way of writing a time, on this device's clock. */
function clockTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return formatStartTime(`${pad(date.getHours())}:${pad(date.getMinutes())}`) ?? "";
}

/**
 * Where a late habit stands, in the viewer's own day and clock, which is how
 * the chat around it tells time: "Not logged yet · ended 10 AM" while there's
 * still time to log it, "Missed yesterday" once the owner's day went by.
 *
 * A friend in another timezone can be a day apart: their missed day can be
 * the viewer's today, and a window can have ended on the viewer's yesterday.
 */
export function lateHabitStatus(habit: LateHabit, now: Date): string {
  if (habit.kind === "encourage") return `Missed ${relativeDay(habit.day, now)}`;

  const closed = new Date(habit.closedAt);
  const day = relativeDay(localDateKey(closed), now);
  return `Not logged yet · ended ${day === "today" ? "" : `${day} at `}${clockTime(closed)}`;
}
