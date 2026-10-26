"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronsUpDown, Repeat } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { FREQUENCIES, type HabitFrequency } from "@/lib/constants/habit";
import { DayChips } from "@/components/habits/DayChips";
import { SETTINGS_ROW, SETTINGS_ROW_ICON } from "@/components/habits/HabitSettingsRows";

/** Custom last, as on iOS: it is the one that asks for more. */
const MENU = (
  ["daily", "weeksdays", "weekends", "weekly", "specific_days"] as const
).map((value) => FREQUENCIES.find((f) => f.value === value)!);

/** What each choice means, where the name alone leaves room to wonder. */
const HINTS: Partial<Record<HabitFrequency, string>> = {
  weeksdays: "Monday to Friday",
  weekends: "Saturday and Sunday",
  weekly: "Once a week, any day",
  specific_days: "Choose the days",
};

interface RepeatPickerProps {
  frequency: HabitFrequency;
  days: number[];
  onChange: (frequency: HabitFrequency, days: number[]) => void;
}

/**
 * How often a habit comes round, as one row: the choice is named on the
 * right and opens as a menu, the way a pop-up button does on iOS. Five chips
 * used to wrap into two ragged rows for a setting most habits leave on
 * Every day.
 *
 * Custom is the one choice that needs more, so only Custom unfolds the days,
 * starting from whichever days the previous choice had.
 */
export function RepeatPicker({ frequency, days, onChange }: RepeatPickerProps) {
  const reduceMotion = useReducedMotion();
  const current = FREQUENCIES.find((f) => f.value === frequency) ?? FREQUENCIES[0];

  const toggleDay = (day: number) => {
    const next = days.includes(day)
      ? days.filter((d) => d !== day)
      : [...days, day].sort((a, b) => a - b);
    onChange("specific_days", next);
  };

  return (
    <div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className={cn(
            SETTINGS_ROW,
            "w-full text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-ink",
            "data-[state=open]:bg-surface-hover",
          )}
        >
          <Repeat className={SETTINGS_ROW_ICON} aria-hidden />
          <span className="flex-1 text-base text-text-primary">Repeat</span>
          <span className="text-base text-text-secondary">{current.label}</span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 -ml-1 text-text-tertiary" aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            collisionPadding={16}
            className="view-menu z-50 min-w-56 rounded-lg bg-elevated p-1 shadow-lg border border-bg-secondary"
          >
            <DropdownMenu.RadioGroup
              value={frequency}
              onValueChange={(v) => {
                const choice = FREQUENCIES.find((f) => f.value === v);
                if (choice) onChange(choice.value, choice.days ?? days);
              }}
            >
              {MENU.map((f) => (
                <DropdownMenu.RadioItem
                  key={f.value}
                  value={f.value}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2.5 py-2 cursor-pointer select-none outline-none",
                    "text-text-primary data-[highlighted]:bg-surface-hover",
                  )}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">{f.label}</span>
                    {HINTS[f.value] && (
                      <span className="block text-xs text-text-tertiary">
                        {HINTS[f.value]}
                      </span>
                    )}
                  </span>
                  <DropdownMenu.ItemIndicator>
                    <Check className="w-4 h-4 text-brand-ink" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <AnimatePresence initial={false}>
        {frequency === "specific_days" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <DayChips
              label="Days"
              stateOf={(day) => (days.includes(day) ? "on" : "off")}
              onToggle={toggleDay}
              className="px-4 pb-3"
            />
            {days.length === 0 && (
              <p className="px-4 pb-3 -mt-1 text-xs text-[var(--color-miss)]">
                Choose at least one day.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
