"use client";

import React from "react";
import { Check, CloudRain, Flame } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { Habit } from "@/lib/types/habit";

/**
 * The look of a habit card, shared by every place a habit is shown as one —
 * the dashboard's HabitCard and the capture flow's "Send to…" list — so a
 * change here changes both. Behaviour (swipe drawer, check-in, selection)
 * stays with each caller; these pieces only draw.
 */

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

const SURFACE_CLASS =
  // The habit's color tints the whole card (see .habit-tint in globals.css).
  "hc-surface habit-tint relative flex items-center gap-2 rounded-lg border py-3 pl-2 pr-4 shadow-sm";

/**
 * Class and style for the card surface. Props rather than a component because
 * the dashboard's surface is a draggable div and the picker's is a button.
 */
export function habitSurfaceProps(
  color: string | null | undefined,
  { className, style }: { className?: string; style?: React.CSSProperties } = {},
) {
  return {
    className: cn(SURFACE_CLASS, className),
    style: {
      ["--habit-color" as string]: color ?? undefined,
      ...style,
    } as React.CSSProperties,
  };
}

// ---------------------------------------------------------------------------
// Title row
// ---------------------------------------------------------------------------

interface HabitTitleRowProps {
  emoji: string | null;
  title: string;
  streak?: number | null;
  /**
   * Decides what one step of the streak counts. Only spoken — the pill shows
   * just a number — but a weekly habit's "3" is three weeks, not days.
   */
  frequency?: Habit["frequency"] | null;
  /** Done or rain-checked today: the title steps back. */
  muted?: boolean;
  /** "span" inside a button, where a heading is not allowed. */
  titleAs?: "h3" | "span";
}

export function HabitTitleRow({
  emoji,
  title,
  streak,
  frequency,
  muted = false,
  titleAs: Title = "h3",
}: HabitTitleRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xl leading-none shrink-0">{emoji}</span>
      <Title
        className={cn(
          "font-semibold truncate min-w-0",
          muted ? "text-text-secondary" : "text-text-primary",
        )}
        style={{ fontSize: "var(--text-base)" }}
      >
        {title}
      </Title>

      {/* The streak sits with the title rather than down in a meta row: it is
          the one thing on the card worth keeping, so it reads at a glance. A
          long title gives way to it — the pill is short and fixed.

          The flame says "streak" on its own, so the pill is just the number;
          only the label spells out the unit, since a screen reader gets no
          flame. */}
      {(streak ?? 0) > 0 && (
        <span
          className="shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
          style={{
            color: "var(--color-streak)",
            backgroundColor:
              "color-mix(in srgb, var(--color-streak) 14%, transparent)",
          }}
          aria-label={`${streak}-${frequency === "weekly" ? "week" : "day"} streak`}
        >
          <Flame className="w-3 h-3" aria-hidden />
          {streak}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Circle
// ---------------------------------------------------------------------------

export type HabitCircleState = "open" | "done" | "rain";

/**
 * The round mark at the card's right edge: empty, checked, or rain-checked.
 * Purely visual — the dashboard wraps it in its complete button, the picker
 * puts it inside a row that is already a button. Hover styling keys off a
 * `group` on whichever element is interactive.
 */
export function HabitCircle({
  state,
  animateDone = false,
}: {
  state: HabitCircleState;
  /** Pop the check in, for the moment a habit is completed. */
  animateDone?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center",
        "transition-all duration-200 ease-bounce",
        state === "done" && "bg-success text-white",
        state === "rain" && "border-2",
        state === "open" &&
          "border-2 border-gray-300 group-hover:border-success group-hover:bg-success/10",
      )}
      style={
        state === "rain"
          ? { borderColor: "var(--color-rain)", color: "var(--color-rain)" }
          : undefined
      }
    >
      {state === "done" ? (
        <span
          className={cn(
            animateDone && "animate-[landing-pop_0.3s_var(--ease-bounce)_both]",
          )}
        >
          <Check className="w-5 h-5" strokeWidth={3} />
        </span>
      ) : state === "rain" ? (
        <CloudRain className="w-[18px] h-[18px]" strokeWidth={2.25} />
      ) : null}
    </span>
  );
}
