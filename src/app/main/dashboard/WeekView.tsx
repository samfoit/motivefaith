"use client";

import { memo, useMemo } from "react";
import {
  format,
  startOfWeek,
  addDays,
  eachDayOfInterval,
  isToday,
  isFuture,
} from "date-fns";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toDateKey } from "@/lib/utils/timezone";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";

interface WeekViewProps {
  habits: HabitWithCompletions[];
  timezone: string;
  onHabitPress: (habitId: string) => void;
}

export const WeekView = memo(function WeekView({
  habits,
  timezone,
  onHabitPress,
}: WeekViewProps) {
  const weekDays = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, []);

  // Pre-compute date keys for each day and completion date keys per habit.
  // Reduces O(habits × days × completions) toDateKey calls to O(days + total completions).
  const dayKeyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const day of weekDays) m.set(day.toISOString(), toDateKey(day, timezone));
    return m;
  }, [weekDays, timezone]);

  const completionKeys = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const h of habits)
      m.set(h.id, new Set(h.completions.map((c) => toDateKey(c.completed_at, timezone))));
    return m;
  }, [habits, timezone]);

  return (
    <div className="space-y-2 dv-stagger-container">
      {habits.map((habit) => (
        <div key={habit.id}>
          <button
            type="button"
            onClick={() => onHabitPress(habit.id)}
            className="w-full p-3 rounded-xl bg-[var(--color-bg-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors text-left"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{habit.emoji}</span>
              <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {habit.title}
              </span>
              {(habit.streak_current ?? 0) > 0 && (
                <span className="flex items-center gap-0.5 text-streak ml-auto shrink-0">
                  <Flame className="w-3 h-3" />
                  <span className="text-xs font-mono font-semibold">
                    {habit.streak_current}
                  </span>
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              {weekDays.map((day) => {
                const completed = completionKeys.get(habit.id)?.has(dayKeyMap.get(day.toISOString()) ?? "") ?? false;
                const td = isToday(day);
                const future = isFuture(day) && !td;
                return (
                  <div
                    key={day.toISOString()}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        td
                          ? "text-brand"
                          : "text-[var(--color-text-tertiary)]",
                      )}
                    >
                      {format(day, "EEE")}
                    </span>
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium",
                        completed && "bg-success text-white",
                        !completed &&
                          td &&
                          "ring-2 ring-brand text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)]",
                        !completed &&
                          !td &&
                          !future &&
                          "bg-[var(--color-bg-elevated)] text-[var(--color-text-tertiary)]",
                        !completed &&
                          future &&
                          "bg-[var(--color-bg-elevated)] text-[var(--color-text-tertiary)] opacity-30",
                      )}
                    >
                      {format(day, "d")}
                    </div>
                  </div>
                );
              })}
            </div>
          </button>
        </div>
      ))}
    </div>
  );
});
