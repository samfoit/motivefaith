"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import {
  toDateKey as tzDateKey,
  todayDateKey,
  subtractDays,
  getBrowserTimezone,
} from "@/lib/utils/timezone";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalendarHeatmapProps {
  /** Map of YYYY-MM-DD date keys (in user's timezone) to completion count */
  data: Record<string, number>;
  /** Number of days to display (default 90) */
  days?: number;
  /** Habit category color as hex (used for filled cells) */
  color?: string;
  /** User's IANA timezone — used to align date keys with the data map */
  timezone?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function toDateKey(d: Date, tz: string): string {
  return tzDateKey(d, tz);
}

/** Build an array of dates going back `days` from today, aligned to start on Sunday */
function buildGrid(days: number): Date[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Go back `days` and align to previous Sunday
  const start = new Date(today);
  start.setDate(start.getDate() - days + 1);
  const dayOfWeek = start.getDay(); // 0=Sun
  start.setDate(start.getDate() - dayOfWeek);

  const weeks: Date[][] = [];
  const cursor = new Date(start);

  while (cursor <= today) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  return weeks;
}

function getOpacity(count: number, max: number): number {
  if (count === 0) return 0;
  if (max <= 1) return 1;
  // 3 tiers: low, medium, high
  const ratio = count / max;
  if (ratio <= 0.33) return 0.35;
  if (ratio <= 0.66) return 0.65;
  return 1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CalendarHeatmap({
  data,
  days = 90,
  color = "var(--color-brand)",
  timezone,
  className,
}: CalendarHeatmapProps) {
  const tz = timezone ?? getBrowserTimezone();
  const weeks = useMemo(() => buildGrid(days), [days]);

  const maxCount = useMemo(() => {
    const values = Object.values(data);
    return values.length > 0 ? Math.max(...values) : 1;
  }, [data]);

  const today = todayDateKey(tz);
  const rangeStartKey = subtractDays(today, days - 1);

  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="inline-flex gap-0.5">
        {/* Day labels column */}
        <div className="flex flex-col gap-0.5 pr-1">
          {DAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="h-3 w-6 text-[9px] leading-3 text-text-tertiary text-right"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((date) => {
              const key = toDateKey(date, tz);
              const count = data[key] ?? 0;
              const isOutOfRange = key < rangeStartKey || key > today;

              return (
                <div
                  key={key}
                  className={cn(
                    "h-3 w-3 rounded-xs transition-colors",
                    isOutOfRange
                      ? "bg-transparent"
                      : count > 0
                        ? ""
                        : "bg-bg-secondary",
                  )}
                  style={
                    !isOutOfRange && count > 0
                      ? {
                        backgroundColor: color,
                        opacity: getOpacity(count, maxCount),
                      }
                      : undefined
                  }
                  title={
                    isOutOfRange
                      ? undefined
                      : `${key}: ${count} completion${count !== 1 ? "s" : ""}`
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
