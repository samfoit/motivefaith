"use client";

import { memo, useState, useMemo } from "react";
import { format, eachDayOfInterval, startOfMonth, endOfMonth } from "date-fns";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toDateKey, todayDateKey, getDayOfWeek } from "@/lib/utils/timezone";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";
import { habitDayState, indexHabitDays, type DayState } from "./day-state";
import { DayMark } from "./DayMark";

interface MonthViewProps {
  habits: HabitWithCompletions[];
  timezone: string;
  onHabitPress: (habitId: string) => void;
}

interface DaySummary {
  date: Date;
  key: string;
  /** Each habit's state on this day, in `habits` order. */
  states: DayState[];
  /** Habits this day asks for — done, rain-checked, missed or still to come. */
  due: number;
  done: number;
  rain: number;
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * The month as a grid of progress rings.
 *
 * It used to give every day an 80px square with a row of habit-coloured dots
 * and a "+4" — but habits mostly share the brand colour, so every day showed
 * the same dots and nothing could be read off the month. Now each date sits
 * in a ring that fills green with the share of that day's habits done (blue
 * for rain checks) and turns solid when the day was finished: the shape of
 * the month is readable at a glance, and the grid is short enough that the
 * selected day's habits are on the same screen.
 */
export const MonthView = memo(function MonthView({
  habits,
  timezone,
  onHabitPress,
}: MonthViewProps) {
  const todayKey = todayDateKey(timezone);
  const [selectedKey, setSelectedKey] = useState(todayKey);

  const monthStart = useMemo(() => startOfMonth(new Date()), []);

  const days = useMemo<DaySummary[]>(() => {
    const indexes = habits.map((h) => indexHabitDays(h, timezone));
    return eachDayOfInterval({ start: monthStart, end: endOfMonth(monthStart) }).map(
      (date) => {
        const key = toDateKey(date, timezone);
        const states = habits.map((h, i) =>
          habitDayState(h, indexes[i], date, key, todayKey, timezone),
        );
        return {
          date,
          key,
          states,
          due: states.filter((s) => s !== "off").length,
          done: states.filter((s) => s === "done").length,
          rain: states.filter((s) => s === "rain").length,
        };
      },
    );
  }, [habits, timezone, todayKey, monthStart]);

  const leadingBlanks = (getDayOfWeek(monthStart, timezone) + 6) % 7;

  // Month so far: only days that have happened can be done or missed.
  const monthDone = days.reduce((n, d) => n + (d.key <= todayKey ? d.done : 0), 0);
  const monthDue = days.reduce(
    (n, d) => n + (d.key <= todayKey ? d.due : 0),
    0,
  );

  const selected = days.find((d) => d.key === selectedKey) ?? days[0];
  const selectedHabits = habits
    .map((habit, i) => ({ habit, state: selected.states[i] }))
    .filter(({ state }) => state !== "off");
  const selectedIsFuture = selected.key > todayKey;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-bg-secondary px-2 pt-3 pb-2">
        <div className="flex items-baseline justify-between gap-3 px-2 mb-2">
          <h2 className="font-display font-medium text-text-primary text-base">
            {format(monthStart, "MMMM yyyy")}
          </h2>
          {monthDue > 0 && (
            <p className="text-xs text-text-secondary tabular-nums">
              {monthDone} of {monthDue} done so far
            </p>
          )}
        </div>

        <div className="grid grid-cols-7" aria-hidden>
          {WEEKDAYS.map((d, i) => (
            <span
              key={i}
              className="text-[10px] font-medium text-text-secondary text-center py-1"
            >
              {d}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {days.map((day) => (
            <DayCell
              key={day.key}
              day={day}
              isToday={day.key === todayKey}
              isFuture={day.key > todayKey}
              isSelected={day.key === selected.key}
              onSelect={setSelectedKey}
            />
          ))}
        </div>
      </div>

      {/* The selected day, in the week grid's row style. */}
      <section aria-live="polite">
        <div className="flex items-baseline justify-between gap-3 mb-2 px-1">
          <h3 className="text-sm font-medium text-text-secondary">
            {selected.key === todayKey ? "Today" : format(selected.date, "EEEE, MMMM d")}
          </h3>
          {selected.due > 0 && !selectedIsFuture && (
            <p className="text-xs text-text-secondary tabular-nums">
              {selected.done} of {selected.due} done
            </p>
          )}
        </div>

        {selectedHabits.length > 0 ? (
          <ul
            key={selected.key}
            className="rounded-lg bg-bg-secondary overflow-hidden divide-y divide-bg-primary mv-day-list"
          >
            {selectedHabits.map(({ habit, state }) => (
              <li key={habit.id}>
                <button
                  type="button"
                  onClick={() => onHabitPress(habit.id)}
                  className="w-full min-h-12 flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="text-base shrink-0" aria-hidden>
                    {habit.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
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
                  <span className="sr-only">{STATE_LABELS[state]}</span>
                  <span className="w-7 flex justify-center shrink-0" aria-hidden>
                    <DayMark state={state} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary text-center py-6">
            Nothing scheduled this day
          </p>
        )}
      </section>
    </div>
  );
});

const STATE_LABELS: Record<DayState, string> = {
  done: "Done",
  rain: "Rain check",
  missed: "Missed",
  today: "Not done yet",
  upcoming: "Scheduled",
  off: "Not scheduled",
};

const RING_SIZE = 34;
const RING_STROKE = 3;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

const DayCell = memo(function DayCell({
  day,
  isToday,
  isFuture,
  isSelected,
  onSelect,
}: {
  day: DaySummary;
  isToday: boolean;
  isFuture: boolean;
  isSelected: boolean;
  onSelect: (key: string) => void;
}) {
  const { due, done, rain } = day;
  const showRing = !isFuture && due > 0;
  const complete = showRing && done === due;
  const doneArc = showRing ? (done / due) * RING_C : 0;
  const rainArc = showRing ? (rain / due) * RING_C : 0;

  const label = `${format(day.date, "MMMM d")}: ${
    due === 0
      ? "nothing scheduled"
      : isFuture
        ? `${due} scheduled`
        : `${done} of ${due} done`
  }`;

  return (
    <button
      type="button"
      onClick={() => onSelect(day.key)}
      aria-label={label}
      aria-pressed={isSelected}
      className={cn(
        "h-12 flex items-center justify-center rounded-lg transition-colors",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
        isSelected ? "bg-surface-hover" : "hover:bg-surface-hover/60",
      )}
    >
      <span
        className="relative flex items-center justify-center"
        style={{ width: RING_SIZE, height: RING_SIZE }}
      >
        {showRing && !complete && (
          <svg
            className="absolute inset-0 -rotate-90"
            width={RING_SIZE}
            height={RING_SIZE}
            aria-hidden
          >
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              fill="none"
              strokeWidth={RING_STROKE}
              className="stroke-text-tertiary/25"
            />
            {doneArc > 0 && (
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                fill="none"
                strokeWidth={RING_STROKE}
                strokeDasharray={`${doneArc} ${RING_C}`}
                className="stroke-success"
              />
            )}
            {rainArc > 0 && (
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                fill="none"
                strokeWidth={RING_STROKE}
                strokeDasharray={`${rainArc} ${RING_C}`}
                strokeDashoffset={-doneArc}
                style={{ stroke: "var(--color-rain)" }}
              />
            )}
          </svg>
        )}
        {complete && <span className="absolute inset-0 rounded-full bg-brand" />}
        <span
          className={cn(
            "relative text-xs tabular-nums leading-none",
            complete
              ? "text-on-brand font-bold"
              : isToday
                ? "text-brand-ink font-bold"
                : isFuture || due === 0
                  ? "text-text-tertiary"
                  : "text-text-primary font-medium",
          )}
        >
          {format(day.date, "d")}
        </span>
      </span>
    </button>
  );
});
