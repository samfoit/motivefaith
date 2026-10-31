import { cn } from "@/lib/utils/cn";
import { weekDays } from "@/lib/utils/weekly-review";

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAME = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** A date key as "Wednesday, Oct 21". */
export function dayName(day: string): string {
  return DAY_NAME.format(new Date(day + "T12:00:00Z"));
}

/** Fill for a day's check-ins: deeper with each one, full from three. */
function fill(count: number): string | undefined {
  if (count <= 0) return undefined;
  const strength = Math.min(count, 3) * 30 + 10;
  return `color-mix(in srgb, var(--color-brand) ${strength}%, transparent)`;
}

/**
 * The week's seven days, Sunday first, each with its check-ins. For the week
 * still running, `today` marks the day it is and fades the days still to come.
 *
 * Given `onSelect`, each day that has come is a button that picks it, and
 * `selected` is ringed. Without it the strip only shows, so it can sit inside
 * a link.
 */
export function WeekStrip({
  weekStart,
  counts,
  today,
  selected,
  onSelect,
}: {
  weekStart: string;
  counts: Record<string, number>;
  today?: string;
  selected?: string | null;
  onSelect?: (day: string) => void;
}) {
  return (
    <ol className="grid grid-cols-7 gap-1.5">
      {weekDays(weekStart).map((day, i) => {
        const count = counts[day] ?? 0;
        const ahead = today !== undefined && day > today;
        const label = `${dayName(day)}: ${
          ahead ? "still to come" : `${count} ${count === 1 ? "check-in" : "check-ins"}`
        }`;
        const cell = (
          <>
            <span
              aria-hidden
              className={cn(
                "text-xs",
                day === today ? "font-semibold text-brand-ink" : "text-text-tertiary",
              )}
            >
              {LETTERS[i]}
            </span>
            <span
              aria-hidden
              className={cn(
                "w-full aspect-square max-w-11 rounded-md flex items-center justify-center",
                "font-mono text-xs tabular-nums transition-shadow",
                // From two check-ins the fill is gold enough to need the
                // buttons' ink: at night the light text fell to 2.7:1 on it,
                // and 1.5:1 on a full one. One check-in's fill is pale, and
                // the page's text reads on it either way.
                count >= 2 ? "text-on-brand" : count === 1 ? "text-text-primary" : "bg-bg-secondary text-transparent",
                ahead && "opacity-40",
                day === selected && "ring-2 ring-brand-ink ring-offset-2 ring-offset-elevated",
              )}
              style={{ backgroundColor: fill(count) }}
            >
              {count > 0 ? count : "·"}
            </span>
          </>
        );
        return (
          <li key={day} className="flex">
            {onSelect && !ahead ? (
              <button
                type="button"
                onClick={() => onSelect(day)}
                aria-label={label}
                aria-pressed={day === selected}
                className="flex-1 flex flex-col items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              >
                {cell}
              </button>
            ) : (
              <span aria-label={label} className="flex-1 flex flex-col items-center gap-1">
                {cell}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
