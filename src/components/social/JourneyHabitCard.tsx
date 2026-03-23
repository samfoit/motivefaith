"use client";

import { Flame, CheckCircle, Clock } from "lucide-react";
import { Container } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Badge";
import type { JourneyHabit } from "@/lib/types/feed";

interface JourneyHabitCardProps {
  habit: JourneyHabit;
  friendName: string;
}

export function JourneyHabitCard({ habit, friendName }: JourneyHabitCardProps) {
  return (
    <Container
      hoverLift
      className="border-l-[3px]"
      style={{ borderLeftColor: habit.color }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0">{habit.emoji}</span>
          <span className="font-medium text-sm text-[var(--color-text-primary)] truncate">
            {habit.title}
          </span>
          <Pill size="sm" variant={habit.isOwner ? "productivity" : "social"}>
            {habit.isOwner ? "Yours" : friendName}
          </Pill>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Today's status */}
          {habit.completedToday ? (
            <div className="flex items-center gap-0.5">
              <CheckCircle className="w-3.5 h-3.5 text-success" />
              <span className="text-xs font-medium text-success">Done</span>
            </div>
          ) : (
            <div className="flex items-center gap-0.5">
              <Clock className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
              <span className="text-xs text-[var(--color-text-tertiary)]">
                Pending
              </span>
            </div>
          )}

          {/* Streak */}
          <div className="flex items-center gap-1">
            <Flame className="w-4 h-4 text-streak" />
            <span className="font-mono text-sm font-semibold text-streak">
              {habit.streak_current}
            </span>
            {habit.streak_best > 0 && (
              <span className="text-xs text-[var(--color-text-tertiary)] ml-0.5">
                / {habit.streak_best}
              </span>
            )}
          </div>
        </div>
      </div>
    </Container>
  );
}
