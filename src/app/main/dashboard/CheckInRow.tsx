"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import { CHECK_IN_OPTIONS, type CheckInAction } from "@/lib/constants/check-in";
import { isPausedOn } from "@/lib/utils/pauses";
import {
  CheckInDrawerOptions,
  DRAWER_SURFACE_CLASS,
  DRAWER_SURFACE_STYLE,
  REPEAT_OPTIONS,
  originOf,
  useCheckInDrawer,
} from "@/components/habits/CheckInDrawer";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";
import type { DayState } from "./day-state";

export type OnCheckIn = (
  habitId: string,
  action: CheckInAction,
  origin?: { x: number; y: number },
) => void;

/**
 * What the drawer offers for today, from today's state in the grid. A
 * check-in always logs today, so a row whose habit is paused today offers
 * nothing; one already done, rain-checked or not due today can still be done
 * (again), but not skipped.
 */
export function todayCheckInOptions(
  habit: HabitWithCompletions,
  todayState: DayState,
  todayKey: string,
) {
  if (habit.is_paused || isPausedOn(habit.pauses ?? [], todayKey)) return null;
  return todayState === "today" ? CHECK_IN_OPTIONS : REPEAT_OPTIONS;
}

interface CheckInRowProps {
  habit: HabitWithCompletions;
  /** The drawer's options, or null for a row that only opens the habit. */
  options: ReturnType<typeof todayCheckInOptions>;
  onCheckIn?: OnCheckIn;
  onPress: (habitId: string) => void;
  "aria-label"?: string;
  children: React.ReactNode;
}

/**
 * A Week or Month row with the Day view's check-in drawer: swipe it left to
 * log today without opening the habit. A tap still opens the habit.
 */
export function CheckInRow({
  habit,
  options,
  onCheckIn,
  onPress,
  "aria-label": ariaLabel,
  children,
}: CheckInRowProps) {
  const enabled = !!options && !!onCheckIn;
  const { isOpen, close, trackRef, surfaceRef, consumeDragClick, trackHandlers } =
    useCheckInDrawer({
      habitId: habit.id,
      enabled,
      optionCount: options?.length ?? 0,
    });

  return (
    <div
      ref={trackRef}
      className="hc-drawer relative overflow-hidden"
      style={{ ["--habit-color" as string]: habit.color ?? undefined } as React.CSSProperties}
      {...trackHandlers}
    >
      {enabled && (
        <CheckInDrawerOptions
          habitTitle={habit.title}
          options={options}
          isOpen={isOpen}
          onPick={(action, e) => {
            e.stopPropagation();
            if (consumeDragClick()) return;
            close();
            onCheckIn(habit.id, action, originOf(e));
          }}
        />
      )}

      {/* The grid's own ground, opaque, so the drawer hides behind it. */}
      <div
        ref={surfaceRef}
        className={cn(DRAWER_SURFACE_CLASS, "relative bg-elevated select-none")}
        style={DRAWER_SURFACE_STYLE}
        onContextMenu={enabled ? (e) => e.preventDefault() : undefined}
      >
        <button
          type="button"
          onClick={() => {
            if (consumeDragClick()) return;
            if (isOpen) {
              close();
              return;
            }
            onPress(habit.id);
          }}
          aria-label={ariaLabel}
          className="w-full min-h-12 flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        >
          {children}
        </button>
      </div>
    </div>
  );
}
