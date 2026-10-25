"use client";

import { memo, useMemo } from "react";
import { format, startOfWeek, addDays, eachDayOfInterval } from "date-fns";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toDateKey, todayDateKey } from "@/lib/utils/timezone";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";
import { habitDayState, indexHabitDays } from "./day-state";
import { DayMark, DayMarkLegendItem } from "./DayMark";

interface WeekViewProps {
  habits: HabitWithCompletions[];
  timezone: string;
  onHabitPress: (habitId: string) => void;
}

/**
 * The week as one grid — habits down the side, days across the top.
 *
 * It used to be a card per habit, each with its own row of seven date
 * circles: two habits filled a phone screen, the dates repeated on every card,
 * and a rain check or an unscheduled day looked the same as a miss. Here the
 * dates are said once, every habit gets a 48px row, and each cell tells the
 * five states apart.
 */
export const WeekView = memo(function WeekView({
  habits,
  timezone,
  onHabitPress,
}: WeekViewProps) {
  const days = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) }).map((date) => ({
      date,
      key: toDateKey(date, timezone),
    }));
  }, [timezone]);

  const todayKey = todayDateKey(timezone);

  const rows = useMemo(
    () =>
      habits.map((habit) => {
        const index = indexHabitDays(habit, timezone);
        const cells = days.map(({ date, key }) =>
          habitDayState(habit, index, date, key, todayKey, timezone),
        );

        const due = cells.filter((c) => c !== "off" && c !== "upcoming").length;
        const done = cells.filter((c) => c === "done").length;
        return { habit, cells, due, done };
      }),
    [habits, days, timezone, todayKey],
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-elevated shadow-sm overflow-hidden">
        {/* Day header — said once for the whole grid. */}
        <div
          className="flex items-end gap-2 px-3 pt-2.5 pb-2 border-b border-bg-primary"
          aria-hidden
        >
          <div className="flex-1" />
          <div className="flex">
            {days.map(({ date, key }) => {
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={cn(
                    "w-7 flex flex-col items-center leading-none",
                    isToday ? "text-brand-ink" : "text-text-secondary",
                  )}
                >
                  <span className="text-[10px] font-medium">
                    {format(date, "EEEEE")}
                  </span>
                  <span
                    className={cn(
                      "mt-1 text-xs tabular-nums",
                      isToday && "font-bold",
                    )}
                  >
                    {format(date, "d")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <ul className="divide-y divide-bg-primary">
          {rows.map(({ habit, cells, due, done }) => (
            <li key={habit.id}>
              <button
                type="button"
                onClick={() => onHabitPress(habit.id)}
                aria-label={`${habit.title}: done ${done} of ${due} ${
                  due === 1 ? "day" : "days"
                } so far this week`}
                className="w-full min-h-12 flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-base shrink-0" aria-hidden>
                    {habit.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {habit.title}
                    </p>
                    {(habit.streak_current ?? 0) > 0 && (
                      <p className="flex items-center gap-0.5 text-streak text-xs font-mono font-semibold">
                        <Flame className="w-3 h-3" aria-hidden />
                        {habit.streak_current}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0" aria-hidden>
                  {cells.map((state, i) => (
                    <div key={days[i].key} className="w-7 h-5 flex items-center justify-center">
                      <DayMark state={state} />
                    </div>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* The marks are new shapes; name them once. */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-text-secondary"
        aria-hidden
      >
        <DayMarkLegendItem state="done" label="Done" />
        <DayMarkLegendItem state="rain" label="Rain check" />
        <DayMarkLegendItem state="missed" label="Missed" />
        <DayMarkLegendItem state="off" label="Not scheduled" />
      </div>
    </div>
  );
});
