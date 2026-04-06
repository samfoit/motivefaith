"use client";

import { memo, useState, useMemo } from "react";
import {
  format,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  isSameDay,
  isToday,
  isFuture,
} from "date-fns";
import { Flame, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toDateKey, getDayOfWeek } from "@/lib/utils/timezone";
import { isHabitScheduledOn } from "@/lib/utils/schedule";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";

// Memoized day cell to avoid re-computing per-day data for the entire grid
const MonthDayCell = memo(function MonthDayCell({
  day,
  habits,
  timezone,
  isSelected,
  onSelect,
  dayKey,
  completionKeys,
}: {
  day: Date;
  habits: HabitWithCompletions[];
  timezone: string;
  isSelected: boolean;
  onSelect: (day: Date) => void;
  dayKey: string;
  completionKeys: Map<string, Set<string>>;
}) {
  const td = isToday(day);
  const future = isFuture(day) && !td;
  const scheduled = habits.filter((h) => isHabitScheduledOn(h, day, timezone));
  const completedHabits = scheduled.filter(
    (h) => completionKeys.get(h.id)?.has(dayKey) ?? false,
  );
  const allDone =
    scheduled.length > 0 &&
    completedHabits.length === scheduled.length &&
    !future;

  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      className={cn(
        "aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors relative",
        isSelected && "bg-brand/10 ring-1 ring-brand",
        !isSelected && td && "bg-[var(--color-bg-elevated)]",
        !isSelected && !td && "hover:bg-[var(--color-surface-hover)]",
      )}
    >
      <span
        className={cn(
          "text-xs font-medium leading-none",
          td && "text-brand",
          !td && !future && "text-[var(--color-text-primary)]",
          future && "text-[var(--color-text-tertiary)]",
          allDone && "text-success",
        )}
      >
        {format(day, "d")}
      </span>

      {/* Habit dots */}
      {scheduled.length > 0 && (
        <div className="flex gap-[2px] items-center">
          {scheduled.slice(0, 4).map((h) => (
            <span
              key={h.id}
              className={cn(
                "w-[5px] h-[5px] rounded-full shrink-0",
                future
                  ? "opacity-25"
                  : (completionKeys.get(h.id)?.has(dayKey) ?? false)
                    ? ""
                    : "opacity-30",
              )}
              style={{
                backgroundColor: h.color ?? "var(--color-brand)",
              }}
            />
          ))}
          {scheduled.length > 4 && (
            <span className="text-[7px] text-[var(--color-text-tertiary)] leading-none">
              +{scheduled.length - 4}
            </span>
          )}
        </div>
      )}
    </button>
  );
});

interface MonthViewProps {
  habits: HabitWithCompletions[];
  timezone: string;
  onHabitPress: (habitId: string) => void;
}

export const MonthView = memo(function MonthView({
  habits,
  timezone,
  onHabitPress,
}: MonthViewProps) {
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  const monthDays = useMemo(() => {
    const now = new Date();
    return eachDayOfInterval({
      start: startOfMonth(now),
      end: endOfMonth(now),
    });
  }, []);

  const monthStartOffset = useMemo(
    () => (getDayOfWeek(startOfMonth(new Date()), timezone) + 6) % 7,
    [timezone],
  );

  // Pre-compute date keys for all month days and completion date keys per habit.
  // Reduces O(habits × days × completions) toDateKey calls to O(days + total completions).
  const dayKeyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const day of monthDays) m.set(day.toISOString(), toDateKey(day, timezone));
    return m;
  }, [monthDays, timezone]);

  const completionKeys = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const h of habits)
      m.set(h.id, new Set(h.completions.map((c) => toDateKey(c.completed_at, timezone))));
    return m;
  }, [habits, timezone]);

  const selectedDayHabits = useMemo(
    () => habits.filter((h) => isHabitScheduledOn(h, selectedDay, timezone)),
    [habits, selectedDay, timezone],
  );

  const selectedDayKey = useMemo(
    () => toDateKey(selectedDay, timezone),
    [selectedDay, timezone],
  );

  return (
    <div className="space-y-4">
      {/* Month header */}
      <h2
        className="text-center font-display font-semibold text-[var(--color-text-primary)]"
        style={{ fontSize: "var(--text-lg)" }}
      >
        {format(monthDays[0], "MMMM yyyy")}
      </h2>

      {/* Calendar grid */}
      <div className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span
              key={d}
              className="text-[10px] font-medium text-[var(--color-text-tertiary)] text-center py-1"
            >
              {d}
            </span>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-px">
          {/* Offset cells */}
          {Array.from({ length: monthStartOffset }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}

          {monthDays.map((day) => (
            <MonthDayCell
              key={day.toISOString()}
              day={day}
              habits={habits}
              timezone={timezone}
              isSelected={isSameDay(day, selectedDay)}
              onSelect={setSelectedDay}
              dayKey={dayKeyMap.get(day.toISOString()) ?? ""}
              completionKeys={completionKeys}
            />
          ))}
        </div>
      </div>

      {/* Selected day habit list */}
      <div>
        <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">
          {isToday(selectedDay)
            ? "Today"
            : format(selectedDay, "EEEE, MMMM d")}
        </h3>
        <div
          key={selectedDay.toISOString()}
          className="space-y-2 mv-day-list"
        >
          {selectedDayHabits.map((habit) => {
            const completed = completionKeys.get(habit.id)?.has(selectedDayKey) ?? false;
            const isPast = !isFuture(selectedDay) || isToday(selectedDay);
            return (
              <div key={habit.id}>
                <button
                  type="button"
                  onClick={() => onHabitPress(habit.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-[var(--color-bg-elevated)] hover:bg-[var(--color-surface-hover)] transition-colors text-left"
                  style={{
                    borderLeft: `3px solid ${habit.color ?? "var(--color-brand)"}`,
                  }}
                >
                  <span className="text-lg">{habit.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate block">
                      {habit.title}
                    </span>
                    {(habit.streak_current ?? 0) > 0 && (
                      <span className="text-xs text-streak flex items-center gap-0.5 mt-0.5">
                        <Flame className="w-3 h-3" />
                        {habit.streak_current} {habit.frequency === "weekly" ? "week" : "day"} streak
                      </span>
                    )}
                  </div>
                  {isPast &&
                    (completed ? (
                      <div className="w-6 h-6 rounded-full bg-success flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 text-white" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-[var(--color-text-tertiary)] shrink-0" />
                    ))}
                </button>
              </div>
            );
          })}
          {selectedDayHabits.length === 0 && (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">
              No habits scheduled
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
