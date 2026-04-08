"use client";

import { memo } from "react";
import { Plus, Flame } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  HabitCard,
  type HabitWithCompletions,
} from "@/components/habits/HabitCard";
import { Button } from "@/components/ui/Button";

type TimeGroup = "morning" | "afternoon" | "evening" | "anytime";

const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  anytime: "Anytime",
};

const TIME_GROUP_ORDER: TimeGroup[] = [
  "morning",
  "afternoon",
  "evening",
  "anytime",
];

interface DayViewProps {
  todayHabits: HabitWithCompletions[];
  groupedHabits: Record<TimeGroup, HabitWithCompletions[]>;
  topStreaks: HabitWithCompletions[];
  completionMap: Map<string, boolean>;
  completedCount: number;
  hasHabits: boolean;
  onQuickComplete: (habitId: string) => void;
  onHabitPress: (habitId: string) => void;
  onLongPress: (habitId: string) => void;
  onCreateHabit: () => void;
}

export const DayView = memo(function DayView({
  todayHabits,
  groupedHabits,
  topStreaks,
  completionMap,
  completedCount,
  hasHabits,
  onQuickComplete,
  onHabitPress,
  onLongPress,
  onCreateHabit,
}: DayViewProps) {
  if (!hasHabits) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-5xl mb-4">🌱</div>
        <h2
          className="font-display font-semibold text-text-primary mb-2"
          style={{ fontSize: "var(--text-xl)" }}
        >
          No habits yet
        </h2>
        <p className="text-sm text-text-secondary mb-6 max-w-xs">
          Start building better habits today. Create your first habit and
          we&apos;ll help you stay on track.
        </p>
        <Button onClick={onCreateHabit}>
          <Plus className="w-4 h-4" />
          <span>Create Your First Habit</span>
        </Button>
      </div>
    );
  }

  const progressRatio = todayHabits.length > 0
    ? completedCount / todayHabits.length
    : 0;

  return (
    <>
      {/* Progress Bar */}
      {todayHabits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-secondary">
              Today&apos;s progress
            </span>
            <span className="text-sm font-mono font-medium text-text-primary">
              {completedCount}/{todayHabits.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-success dv-progress-bar"
              style={{ transform: `scaleX(${progressRatio})` }}
            />
          </div>
          {completedCount === todayHabits.length &&
            todayHabits.length > 0 && (
              <p className="text-sm text-success font-medium mt-2 text-center dv-all-done">
                All done for today!
              </p>
            )}
        </div>
      )}

      {/* Streak Summary Row */}
      {topStreaks.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary mb-3">
            Active Streaks
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
            {topStreaks.map((habit) => (
              <button
                key={habit.id}
                className={cn(
                  "shrink-0 flex items-center gap-2 rounded-lg px-3 py-2",
                  "bg-bg-secondary",
                  "text-left dv-streak-btn",
                )}
                onClick={() => onHabitPress(habit.id)}
              >
                <span className="text-base">{habit.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs text-text-secondary truncate max-w-25">
                    {habit.title}
                  </p>
                  <p className="text-sm font-mono font-semibold text-streak flex items-center gap-0.5">
                    <Flame className="w-3.5 h-3.5" />
                    {habit.streak_current}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Habit List by Time Group */}
      {todayHabits.length > 0 && (
        <div className="space-y-6">
          {TIME_GROUP_ORDER.map((group) => {
            const groupHabits = groupedHabits[group];
            if (groupHabits.length === 0) return null;

            return (
              <div key={group}>
                <h2 className="text-sm font-medium text-text-secondary mb-3">
                  {TIME_GROUP_LABELS[group]}
                </h2>
                <div className="space-y-3 dv-stagger-container">
                  {groupHabits.map((habit) => (
                    <div key={habit.id}>
                      <HabitCard
                        habit={habit}
                        completedToday={completionMap.get(habit.id) ?? false}
                        onQuickComplete={onQuickComplete}
                        onPress={onHabitPress}
                        onLongPress={onLongPress}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No habits scheduled today */}
      {todayHabits.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-text-secondary">
            No habits scheduled for today
          </p>
        </div>
      )}
    </>
  );
});
