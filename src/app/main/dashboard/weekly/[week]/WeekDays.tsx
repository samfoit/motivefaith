"use client";

import { useState, type ReactNode } from "react";
import { Check, Clock, CloudRain, Pause, X } from "lucide-react";
import type { Json } from "@/lib/supabase/types";
import { formatStartTime } from "@/lib/utils/schedule";
import { dayHabits, groupDay, type DayHabit } from "@/lib/utils/weekly-review";
import { WeekStrip, dayName } from "../WeekStrip";

/** The right-hand note for a habit on a day: when, or what became of it. */
function note(h: DayHabit): string {
  const times = h.times.map((t) => formatStartTime(t)).filter(Boolean).join(", ");
  switch (h.status) {
    case "done":
      return times;
    case "extra":
      return times ? `${times}, not due` : "Not due";
    case "missed":
      return h.weekly ? "Not done this week" : "Missed";
    case "pending":
      return "Not done yet";
    case "open":
      return "Due this week";
    case "excused":
      return h.reason ? `Rain check, ${h.reason}` : h.weekly ? "Rain check this week" : "Rain check";
    case "paused":
      return "Paused";
    default:
      return "";
  }
}

const ICONS: Partial<Record<DayHabit["status"], ReactNode>> = {
  done: <Check className="w-4 h-4" style={{ color: "var(--color-success)" }} />,
  extra: <Check className="w-4 h-4" style={{ color: "var(--color-success)" }} />,
  missed: <X className="w-4 h-4" style={{ color: "var(--color-miss)" }} />,
  pending: <Clock className="w-4 h-4 text-text-tertiary" />,
  open: <Clock className="w-4 h-4 text-text-tertiary" />,
  excused: <CloudRain className="w-4 h-4" style={{ color: "var(--color-rain)" }} />,
  paused: <Pause className="w-4 h-4 text-text-tertiary" />,
};

function Group({ title, habits }: { title: string; habits: DayHabit[] }) {
  if (habits.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold text-text-secondary px-4 pt-3 pb-1">
        {title} <span className="font-normal text-text-tertiary">{habits.length}</span>
      </h4>
      <ul>
        {habits.map((h) => (
          <li key={h.habitId} className="flex items-center gap-3 px-4 py-2">
            <span aria-hidden className="shrink-0">{ICONS[h.status]}</span>
            <span className="flex-1 min-w-0 truncate text-sm text-text-primary">
              {h.emoji && <span aria-hidden className="mr-1.5">{h.emoji}</span>}
              {h.title}
            </span>
            <span className="shrink-0 text-sm text-text-secondary tabular-nums">{note(h)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The week's days, each tappable to show what was done on it and what was
 * not. Picking a day puts it in the address, so a reload or a shared link
 * opens on it.
 */
export function WeekDays({
  weekStart,
  counts,
  days,
  today,
  initialDay,
}: {
  weekStart: string;
  counts: Record<string, number>;
  days: Json;
  today?: string;
  initialDay: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialDay);

  const select = (day: string) => {
    const next = day === selected ? null : day;
    setSelected(next);
    window.history.replaceState(null, "", next ? `?day=${next}` : window.location.pathname);
  };

  const habits = selected ? dayHabits(days, selected) : [];
  const groups = groupDay(habits);

  return (
    <section aria-label="Days of the week" className="rounded-lg bg-elevated shadow-sm">
      <div className="p-4">
        <WeekStrip
          weekStart={weekStart}
          counts={counts}
          today={today}
          selected={selected}
          onSelect={select}
        />
      </div>

      <div aria-live="polite" className="border-t border-border">
        {selected === null ? (
          <p className="px-4 py-3 text-sm text-text-tertiary">Tap a day to see what you did.</p>
        ) : (
          <div className="pb-2">
            <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary">{dayName(selected)}</h3>
            {habits.length === 0 ? (
              <p className="px-4 py-2 text-sm text-text-tertiary">No habits yet on this day.</p>
            ) : (
              <>
                <Group title="Done" habits={groups.done} />
                <Group title="Not done" habits={groups.notDone} />
                <Group title="Excused" habits={groups.excused} />
                {groups.doneThisWeek.length > 0 && (
                  <p className="px-4 pt-3 text-xs text-text-tertiary">
                    Done another day this week: {groups.doneThisWeek.map((h) => h.title).join(", ")}
                  </p>
                )}
                {groups.notDue.length > 0 && (
                  <p className="px-4 pt-1 first:pt-3 text-xs text-text-tertiary">
                    Not due: {groups.notDue.map((h) => h.title).join(", ")}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
