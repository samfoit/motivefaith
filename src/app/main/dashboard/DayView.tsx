"use client";

import { memo } from "react";
import { Plus, Flame } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  HabitCard,
  type HabitWithCompletions,
} from "@/components/habits/HabitCard";
import type { CheckInAction } from "@/lib/constants/check-in";
import type { MoveLabels } from "@/lib/types/habit";
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
  rainCheckMap?: Map<string, boolean>;
  /** Per-habit move labels: what moved away today, and what landed. */
  moveMap?: Map<string, MoveLabels>;
  completedCount: number;
  hasHabits: boolean;
  onQuickComplete: (habitId: string, origin?: { x: number; y: number }) => void;
  onHabitPress: (habitId: string) => void;
  onCheckIn: (
    habitId: string,
    action: CheckInAction,
    origin?: { x: number; y: number },
  ) => void;
  onCreateHabit: () => void;
}

export const DayView = memo(function DayView({
  todayHabits,
  groupedHabits,
  topStreaks,
  completionMap,
  rainCheckMap,
  moveMap,
  completedCount,
  hasHabits,
  onQuickComplete,
  onHabitPress,
  onCheckIn,
  onCreateHabit,
}: DayViewProps) {
  if (!hasHabits) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-5xl mb-4">🌱</div>
        <h2
          className="font-display font-medium text-text-primary mb-2"
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

  // The card that demonstrates the check-in drawer: the first one on screen
  // that still has a drawer to show.
  const peekHabitId = TIME_GROUP_ORDER.flatMap((g) => groupedHabits[g]).find(
    (h) => !completionMap.get(h.id),
  )?.id;

  const progressRatio = todayHabits.length > 0
    ? completedCount / todayHabits.length
    : 0;

  return (
    <>
      {/* Progress Bar */}
      {todayHabits.length > 0 && (
        <div>
          {/* No visible label — a bar and a count read as today's progress on
              their own — so the bar carries one for screen readers. */}
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="Today's progress"
              aria-valuemin={0}
              aria-valuemax={todayHabits.length}
              aria-valuenow={completedCount}
              className="flex-1 h-2 rounded-full bg-surface-hover overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-brand shadow-[var(--lamp-glow-bar)] dv-progress-bar"
                style={{ transform: `scaleX(${progressRatio})` }}
              />
            </div>
            <span className="text-sm font-mono font-medium text-text-primary">
              {completedCount}/{todayHabits.length}
            </span>
          </div>
          {completedCount === todayHabits.length &&
            todayHabits.length > 0 && (
              <p className="text-sm text-success font-medium mt-2 text-center dv-all-done">
                All done for today!
              </p>
            )}
        </div>
      )}

      {/* Streak Summary Row: plain words, the lamp in the look (flame in its glow) */}
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
                  "shrink-0 flex items-center gap-2.5 rounded-xl py-2.5 pl-2.5 pr-3.5",
                  "bg-bg-elevated border border-border",
                  "text-left dv-streak-btn",
                )}
                onClick={() => onHabitPress(habit.id)}
              >
                <span
                  aria-hidden
                  className="flex items-center justify-center w-8 h-8 rounded-full text-streak"
                  style={{ background: "var(--lamp-halo)" }}
                >
                  <Flame className="w-4.5 h-4.5" fill="currentColor" strokeWidth={1.5} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] text-text-primary truncate max-w-25">
                    {habit.title}
                  </p>
                  <p className="text-xs text-text-secondary tabular-nums">
                    {habit.streak_current} {habit.streak_current === 1 ? "day" : "days"}
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
                        rainCheckedToday={rainCheckMap?.get(habit.id) ?? false}
                        rainCheckMovedTo={
                          moveMap?.get(habit.id)?.movedTo ?? null
                        }
                        movedFrom={moveMap?.get(habit.id)?.movedFrom ?? null}
                        onQuickComplete={onQuickComplete}
                        onPress={onHabitPress}
                        onCheckIn={onCheckIn}
                        peek={habit.id === peekHabitId}
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
