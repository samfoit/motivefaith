"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { DayChips, type DayChipState } from "@/components/habits/DayChips";
import { RowSwitch, SETTINGS_ROW, TimeField } from "@/components/habits/HabitSettingsRows";
import {
  newExceptionDays,
  shownExceptions,
  usualDays,
  type TimeException,
  type TimeWindowFields,
} from "@/lib/utils/schedule";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The days that keep a different time from the usual one, under the time
 * window's own From and Until: "8 on weekdays, 4 at the weekend" as one
 * habit. Each picks its days from the habit's and has its own window, or no
 * set time at all.
 *
 * A day belongs to one time. Choosing a day another time has moves it here,
 * and deselecting one returns it to the usual time — which always keeps at
 * least one day, so its last can't be taken.
 *
 * Nothing shows until asked for: one quiet button, and only while the usual
 * time has days to spare. Weekly habits have none of this: done once, on any
 * day, they have no day to give a time to.
 */
export function TimeWindowExceptions({
  fields,
  onChange,
}: {
  fields: TimeWindowFields;
  onChange: (exceptions: TimeException[]) => void;
}) {
  const reduceMotion = useReducedMotion();
  if (fields.frequency === "weekly") return null;

  const all = fields.timeWindowExceptions;
  const shown = shownExceptions(fields);
  const usual = usualDays(fields);
  const scheduled = new Set(fields.scheduleDays);

  const update = (id: string, patch: Partial<TimeException>) =>
    onChange(all.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const toggleDay = (id: string, day: number) =>
    onChange(
      all.map((e) => {
        if (e.id !== id) return { ...e, days: e.days.filter((d) => d !== day) };
        return e.days.includes(day)
          ? { ...e, days: e.days.filter((d) => d !== day) }
          : { ...e, days: [...e.days, day].sort((a, b) => a - b) };
      }),
    );

  const add = () =>
    onChange([
      ...all,
      {
        id: crypto.randomUUID(),
        days: newExceptionDays(usual),
        timed: true,
        // The usual time, so adding one changes nothing until it is set.
        start: fields.timeWindowStart,
        end: fields.timeWindowEnd,
      },
    ]);

  const stateOf =
    (exception: TimeException) =>
    (day: number): DayChipState => {
      if (!scheduled.has(day)) return "unavailable";
      if (exception.days.includes(day)) return "on";
      if (usual.length === 1 && usual[0] === day) return "unavailable";
      return shown.some((e) => e !== exception && e.days.includes(day)) ? "taken" : "off";
    };

  const reveal = {
    initial: { height: 0, opacity: 0 },
    animate: { height: "auto", opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE },
  };

  return (
    <>
      <AnimatePresence initial={false}>
        {shown.map((exception, i) => (
          <motion.div key={exception.id} {...reveal} className="overflow-hidden">
            <div
              role="group"
              aria-label={`Different time ${i + 1}`}
              className="border-t border-border"
            >
              <DayChips
                label="Days"
                stateOf={stateOf(exception)}
                onToggle={(day) => toggleDay(exception.id, day)}
                className="px-4 pt-3 pb-1"
              />
              {exception.days.length === 0 && (
                <p className="px-4 pt-1 text-xs text-[var(--color-miss)]">
                  Choose at least one day.
                </p>
              )}

              <label className={cn(SETTINGS_ROW, "min-h-11 py-2 cursor-pointer")}>
                <span className="flex-1 text-sm text-text-primary">Set a time</span>
                <RowSwitch
                  checked={exception.timed}
                  onCheckedChange={(timed) => update(exception.id, { timed })}
                />
              </label>

              {exception.timed ? (
                <div className="grid grid-cols-2 gap-2 px-4 pb-1">
                  <TimeField
                    label="From"
                    value={exception.start}
                    onChange={(start) => update(exception.id, { start })}
                  />
                  <TimeField
                    label="Until"
                    value={exception.end}
                    onChange={(end) => update(exception.id, { end })}
                  />
                </div>
              ) : (
                <p className="px-4 text-xs text-text-secondary text-pretty">
                  Any time on these days: no reminder, no missed alert.
                </p>
              )}

              <div className="flex justify-end px-2 pb-1">
                <button
                  type="button"
                  onClick={() => onChange(all.filter((e) => e.id !== exception.id))}
                  className={cn(
                    "min-h-11 px-2 text-sm text-text-secondary rounded-md",
                    "hover:text-text-primary",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
                  )}
                >
                  Remove
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {usual.length >= 2 && (
        <button
          type="button"
          onClick={add}
          className={cn(
            "w-full min-h-11 flex items-center gap-2 px-4 text-sm font-medium text-brand-ink text-left",
            "hover:bg-surface-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-ink",
            shown.length > 0 && "border-t border-border",
          )}
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden />
          {shown.length === 0 ? "Different time on some days" : "Another time for other days"}
        </button>
      )}
    </>
  );
}
