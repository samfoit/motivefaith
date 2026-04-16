"use client";

import React, { useRef, useCallback, useEffect } from "react";
import { Check, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils/cn";
import type { Tables } from "@/lib/supabase/types";

const LONG_PRESS_MS = 400;

type CompletionSlice = {
  id: string;
  completed_at: string;
  completion_type: Tables<"completions">["completion_type"];
};

export type HabitWithCompletions = Tables<"habits"> & {
  completions: CompletionSlice[];
  challenge?: { title: string; emoji: string } | null;
};

interface HabitCardProps {
  habit: HabitWithCompletions;
  completedToday: boolean;
  onQuickComplete: (habitId: string, origin?: { x: number; y: number }) => void;
  onPress?: (habitId: string) => void;
  onLongPress?: (habitId: string) => void;
  className?: string;
}

export const HabitCard = React.memo(function HabitCard({
  habit,
  completedToday,
  onQuickComplete,
  onPress,
  onLongPress,
  className,
}: HabitCardProps) {
  const latestCompletion = habit.completions.length
    ? habit.completions.reduce((latest, c) =>
      new Date(c.completed_at) > new Date(latest.completed_at) ? c : latest,
    )
    : null;

  const lastCompletionLabel = latestCompletion
    ? formatDistanceToNow(new Date(latestCompletion.completed_at), {
      addSuffix: true,
    })
    : null;

  const timeWindow = habit.time_window as { start?: string; end?: string } | null;
  const scheduledTime = timeWindow?.start
    ? (() => {
      const [h, m] = timeWindow.start!.split(":").map(Number);
      const suffix = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
    })()
    : null;

  const handleCircleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completedToday) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onQuickComplete(habit.id, {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  // Prevent text selection highlight on long press (iOS)
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener("selectstart", prevent);
    return () => el.removeEventListener("selectstart", prevent);
  }, []);

  // --- Long-press detection ---
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const clearLongPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    didLongPress.current = false;
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
      timerRef.current = null;
      // Haptic feedback
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(30);
      }
      onLongPress?.(habit.id);
    }, LONG_PRESS_MS);
  }, [habit.id, onLongPress]);

  const handlePointerUp = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handleClick = useCallback(() => {
    if (didLongPress.current) return;
    onPress?.(habit.id);
  }, [habit.id, onPress]);

  return (
    <div
      ref={cardRef}
      className={cn(
        "relative flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm",
        "border-l-[3px] cursor-pointer select-none touch-manipulation",
        "transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
        "hover:-translate-y-0.5 hover:scale-[1.01]",
        "active:scale-[0.97]",
        className,
      )}
      style={{ borderLeftColor: habit.color ?? undefined, WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent" }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
    >
      {/* Emoji + Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{habit.emoji}</span>
          <h3
            className={cn(
              "font-medium truncate",
              completedToday
                ? "text-text-secondary"
                : "text-text-primary",
            )}
            style={{ fontSize: "var(--text-lg)" }}
          >
            {habit.title}
          </h3>
        </div>

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {scheduledTime && (
            <span className="text-xs text-text-tertiary flex items-center gap-0.5">
              <Clock className="w-3 h-3" />
              {scheduledTime}
            </span>
          )}
          {habit.challenge && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-light text-brand">
              {habit.challenge.emoji} {habit.challenge.title}
            </span>
          )}
          {(habit.streak_current ?? 0) > 0 && (
            <span className="text-xs font-mono text-streak flex items-center gap-0.5">
              {habit.streak_current}-{habit.frequency === "weekly" ? "week" : "day"} streak
            </span>
          )}
          {lastCompletionLabel && (
            <span className="text-xs text-text-tertiary">
              {lastCompletionLabel}
            </span>
          )}
        </div>
      </div>

      {/* Complete Circle */}
      <button
        onClick={handleCircleClick}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={completedToday}
        className={cn(
          "shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
          "transition-all duration-200 ease-bounce",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand",
          completedToday
            ? "bg-success text-white"
            : "border-2 border-gray-300 hover:border-success hover:bg-success/10 active:scale-90",
        )}
        aria-label={
          completedToday
            ? `${habit.title} completed`
            : `Complete ${habit.title}`
        }
      >
        {completedToday && (
          <div className="animate-[landing-pop_0.3s_var(--ease-bounce)_both]">
            <Check className="w-5 h-5" strokeWidth={3} />
          </div>
        )}
      </button>
    </div>
  );
});
