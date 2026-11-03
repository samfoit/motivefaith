"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils/cn";
import { CHECK_IN_OPTIONS, type CheckInAction } from "@/lib/constants/check-in";
import { isPausedOn } from "@/lib/utils/pauses";
import {
  CheckInDrawerOptions,
  DRAWER_SURFACE_CLASS,
  DRAWER_SURFACE_STYLE,
  DrawerHandle,
  REPEAT_OPTIONS,
  originOf,
  useCheckInDrawer,
} from "@/components/habits/CheckInDrawer";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";
import {
  HabitCircle,
  habitSurfaceProps,
  type HabitCircleState,
} from "@/components/habits/HabitCardParts";
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
  /**
   * Today's check-in circle, leading the row as on the Day view's cards: a
   * tap logs a quick check-in. Done, it stays put and logs nothing more.
   */
  circle?: {
    state: HabitCircleState;
    onComplete: (habitId: string, origin?: { x: number; y: number }) => void;
  };
  /** In the circle's place on a row that can't check in: its day's mark. */
  leading?: React.ReactNode;
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
  circle,
  leading,
  "aria-label": ariaLabel,
  children,
}: CheckInRowProps) {
  const drawerId = useId();
  const enabled = !!options && !!onCheckIn;
  const { isOpen, toggle, close, trackRef, surfaceRef, consumeDragClick, trackHandlers } =
    useCheckInDrawer({
      habitId: habit.id,
      enabled,
      optionCount: options?.length ?? 0,
    });

  return (
    <div
      ref={trackRef}
      className="hc-drawer relative overflow-hidden rounded-lg"
      style={{ ["--habit-color" as string]: habit.color ?? undefined } as React.CSSProperties}
      {...trackHandlers}
    >
      {enabled && (
        <CheckInDrawerOptions
          id={drawerId}
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

      {/* The Day view's card surface — the habit's wash and colored edge —
          at a row's height. Opaque, so the drawer hides behind it. */}
      <div
        ref={surfaceRef}
        {...habitSurfaceProps(habit.color, {
          className: cn(
            DRAWER_SURFACE_CLASS,
            "gap-0 p-0 hover:brightness-[0.97] select-none",
          ),
          style: DRAWER_SURFACE_STYLE,
        })}
        onContextMenu={enabled ? (e) => e.preventDefault() : undefined}
      >
        {circle ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (consumeDragClick() || circle.state === "done") return;
              close();
              circle.onComplete(habit.id, originOf(e));
            }}
            // aria-disabled rather than disabled: a disabled button swallows
            // the pointer events a drag starting on it needs.
            aria-disabled={circle.state === "done"}
            aria-label={
              circle.state === "done"
                ? `${habit.title} completed`
                : circle.state === "rain"
                  ? `${habit.title} rain-checked today — check in anyway`
                  : `Complete ${habit.title}`
            }
            className={cn(
              // after: stretches the 28px circle's tap area to 44px.
              "group relative shrink-0 ml-3 rounded-full after:absolute after:-inset-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-ink",
              circle.state !== "done" && "active:scale-90 transition-transform",
            )}
          >
            <HabitCircle state={circle.state} size="sm" animateDone />
          </button>
        ) : leading ? (
          <span className="shrink-0 ml-3 w-7 flex justify-center" aria-hidden>
            {leading}
          </span>
        ) : null}
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
          className="flex-1 min-w-0 min-h-12 flex items-center gap-2 pl-3 pr-2 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        >
          {children}
        </button>
        {/* The drawer's sign, as on the Day view's cards. A row with no
            drawer keeps the space, so the Week grid's columns stay lined up
            with its header. */}
        {enabled ? (
          <DrawerHandle
            isOpen={isOpen}
            drawerId={drawerId}
            habitTitle={habit.title}
            onToggle={() => {
              if (!consumeDragClick()) toggle();
            }}
            className="mr-1"
          />
        ) : (
          <div className="shrink-0 w-7 mr-1" aria-hidden />
        )}
      </div>
    </div>
  );
}
