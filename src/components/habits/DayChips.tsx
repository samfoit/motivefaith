"use client";

import { cn } from "@/lib/utils/cn";
import { DAYS } from "@/lib/constants/habit";

/**
 * on           the day is in this set
 * off          it is not, and can be
 * taken        another of the habit's times has it; choosing it moves it here
 * unavailable  it cannot be chosen here
 */
export type DayChipState = "on" | "off" | "taken" | "unavailable";

interface DayChipsProps {
  /** Names the row for assistive technology. */
  label: string;
  stateOf: (day: number) => DayChipState;
  onToggle: (day: number) => void;
  className?: string;
}

/**
 * The week as a row of round day buttons, Sunday first: Repeat picks the
 * habit's days with it, and each different time picks its own.
 */
export function DayChips({ label, stateOf, onToggle, className }: DayChipsProps) {
  return (
    <div role="group" aria-label={label} className={cn("flex justify-between gap-1", className)}>
      {DAYS.map((day) => {
        const state = stateOf(day.value);
        return (
          <button
            key={day.value}
            type="button"
            onClick={() => onToggle(day.value)}
            disabled={state === "unavailable"}
            aria-label={state === "taken" ? `${day.full}, set to another time` : day.full}
            aria-pressed={state === "on"}
            className={cn(
              "w-10 h-10 rounded-full text-sm font-medium flex items-center justify-center",
              "transition-[transform,background-color,color] duration-150 active:scale-90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-ink focus-visible:ring-offset-[var(--color-bg-elevated)]",
              state === "on" && "bg-brand text-on-brand",
              state === "off" && "bg-bg-secondary text-text-primary hover:bg-surface-hover",
              // Still a button: choosing it moves the day here.
              state === "taken" && "bg-bg-secondary text-text-tertiary hover:bg-surface-hover",
              state === "unavailable" && "text-text-tertiary opacity-50 active:scale-100",
            )}
          >
            {day.label}
          </button>
        );
      })}
    </div>
  );
}
