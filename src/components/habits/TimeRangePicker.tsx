"use client";

import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatStartTime } from "@/lib/utils/schedule";

const EASE = [0.16, 1, 0.3, 1] as const;

/** As a clock face reads: 12 first. */
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * Quarter hours up front, the times most habits keep. Any other minute is a
 * tap further, under "Exact minute": 10:02 PM, for Luke 10:2. Reminders still
 * go out on the quarter hour (habit-reminders), so a habit at 10:02 is
 * reminded at 10:00.
 */
const MINUTES = [0, 15, 30, 45];

// ---------------------------------------------------------------------------
// One picker open at a time
// ---------------------------------------------------------------------------

interface OpenPicker {
  open: string | null;
  setOpen: (key: string | null) => void;
}

const OpenPickerContext = createContext<OpenPicker | null>(null);

/**
 * Keeps one time picker open at a time among the ranges inside it, so the
 * usual time and each different time do not all unfold at once.
 */
export function TimePickerScope({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <OpenPickerContext.Provider value={value}>{children}</OpenPickerContext.Provider>;
}

// ---------------------------------------------------------------------------
// "HH:MM", as hour, minute and half of the day
// ---------------------------------------------------------------------------

interface TimeParts {
  hour12: number;
  minute: number;
  pm: boolean;
}

function toParts(value: string): TimeParts {
  const [h, m] = value.split(":").map(Number);
  const hour = Number.isInteger(h) && h >= 0 && h < 24 ? h : 9;
  const minute = Number.isInteger(m) && m >= 0 && m < 60 ? m : 0;
  return { hour12: hour % 12 || 12, minute, pm: hour >= 12 };
}

function toValue({ hour12, minute, pm }: TimeParts): string {
  const hour = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The range
// ---------------------------------------------------------------------------

/** Minutes since midnight, and back. */
const minutesOf = (value: string) => {
  const { hour12, minute, pm } = toParts(value);
  return ((hour12 % 12) + (pm ? 12 : 0)) * 60 + minute;
};
const atMinutes = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
const LAST_MINUTE = 23 * 60 + 59;

interface TimeRangePickerProps {
  start: string;
  end: string;
  onChange: (range: { start: string; end: string }) => void;
  /** The two fields' names. A habit's window runs From and Until. */
  labels?: { start: string; end: string };
  /**
   * May run past midnight, as quiet hours do. A habit's window may not: its
   * day is the calendar day, so one that ran 6 PM to 10 AM was missed at
   * 11 AM against a window that opened only that evening.
   */
  overnight?: boolean;
}

/**
 * From and Until as two fields, each unfolding a picker in place — hour
 * chips like the day buttons, then the minutes and AM or PM on the app's
 * own segmented track — rather than the browser's, which drew a blue list
 * over the form and looked like nothing else in the app.
 *
 * The picker sits in the page's order right after the field it belongs to,
 * though it shows below both: Tab goes from From into its picker and then on
 * to Until. Every change applies at once; tapping the field again folds it
 * away, and Escape does from inside it.
 *
 * Unless the range may run overnight, Until stays after From. Moving From to
 * or past Until carries Until along, keeping the window's length, as a
 * calendar keeps an event's; an Until set at or before From is pointed out.
 */
export function TimeRangePicker({
  start,
  end,
  onChange,
  labels = { start: "From", end: "Until" },
  overnight = false,
}: TimeRangePickerProps) {
  const id = useId();
  const scope = useContext(OpenPickerContext);
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const open = scope ? scope.open : localOpen;
  const setOpen = scope ? scope.setOpen : setLocalOpen;
  const reduceMotion = useReducedMotion();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  // The window's length when From was opened. A time is set in a few taps,
  // and measured after each one, 9 to 12 moved to 1 PM would pass through
  // 1 AM to 12 — eleven hours — and carry Until to midnight.
  const [length, setLength] = useState(60);

  const outOfOrder = !overnight && minutesOf(end) <= minutesOf(start);
  const errorId = `${id}-order`;

  const setStart = (next: string) => {
    if (overnight || minutesOf(next) < minutesOf(end)) {
      onChange({ start: next, end });
      return;
    }
    onChange({ start: next, end: atMinutes(Math.min(minutesOf(next) + length, LAST_MINUTE)) });
  };

  const fields = [
    { key: `${id}-start`, label: labels.start, value: start, onChange: setStart, column: "col-start-1" },
    { key: `${id}-end`, label: labels.end, value: end, onChange: (next: string) => onChange({ start, end: next }), column: "col-start-2" },
  ];
  const openKey = fields.find((f) => f.key === open)?.key ?? null;
  // Moving from one field's picker to the other's swaps them at once, so
  // the two never fold over each other in the same row.
  const switching = openKey !== null;

  // Escape from the open picker, or its field, folds the picker. The sheet
  // around the form listens on the document as the key goes down, ahead of
  // anything here, and would close the whole sheet — so this listens on the
  // window, which hears it first, and stops it there.
  useEffect(() => {
    if (!openKey) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !(e.target instanceof Node)) return;
      const button = buttons.current[openKey];
      const picker = document.getElementById(`${openKey}-picker`);
      if (!button?.contains(e.target) && !picker?.contains(e.target)) return;
      e.stopPropagation();
      setOpen(null);
      button?.focus();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [openKey, setOpen]);

  return (
    <div className="grid grid-cols-2 gap-x-2">
      {fields.map((field, i) => {
        const isOpen = open === field.key;
        const pickerId = `${field.key}-picker`;
        const display = formatStartTime(field.value) ?? "Set a time";
        return (
          <Fragment key={field.key}>
            <button
              ref={(el) => {
                buttons.current[field.key] = el;
              }}
              type="button"
              onClick={() => {
                if (!isOpen && i === 0) {
                  const span = minutesOf(end) - minutesOf(start);
                  setLength(span > 0 ? span : 60);
                }
                setOpen(isOpen ? null : field.key);
              }}
              aria-expanded={isOpen}
              aria-controls={isOpen ? pickerId : undefined}
              aria-label={`${field.label}, ${display}`}
              aria-describedby={outOfOrder && i === 1 ? errorId : undefined}
              className={cn(
                field.column,
                "row-start-1 min-w-0 flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left",
                "transition-colors duration-150",
                // Inset: the window's reveal clips anything drawn outside it.
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-ink",
                isOpen
                  ? "bg-brand-light ring-2 ring-inset ring-brand-ink"
                  : "bg-bg-secondary hover:bg-surface-hover",
              )}
            >
              <span className="min-w-0 flex flex-col">
                <span className="text-xs text-text-secondary">{field.label}</span>
                <span className="truncate text-base leading-6 text-text-primary tabular-nums">
                  {display}
                </span>
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "w-4 h-4 shrink-0 text-text-secondary transition-transform duration-200",
                  isOpen && "rotate-180",
                )}
              />
            </button>

            <AnimatePresence initial={false} custom={switching}>
              {isOpen && (
                <motion.div
                  key="picker"
                  custom={switching}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit="exit"
                  variants={{
                    exit: (swap: boolean) => ({
                      height: 0,
                      opacity: 0,
                      transition: { duration: swap || reduceMotion ? 0 : 0.22, ease: EASE },
                    }),
                  }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE }}
                  className="col-span-2 row-start-3 overflow-hidden"
                >
                  <TimeGrid
                    id={pickerId}
                    label={field.label}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </Fragment>
        );
      })}

      {/* Between the fields and the picker, so it is in view while either
          is being fixed. Always there, empty when all is well: a live
          region added along with its words may not be read out. */}
      <p
        id={errorId}
        aria-live="polite"
        className={cn(
          "col-span-2 row-start-2 text-xs text-[var(--color-miss)] text-pretty",
          outOfOrder && "pt-2",
        )}
      >
        {outOfOrder &&
          `${labels.end} has to be after ${labels.start}. A window can't run past midnight — for something overnight, like a fast, track it on the day it ends.`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

/**
 * Hour, minutes and half of the day, each a native radio group under its
 * chip: arrow keys move through a group and Tab moves between them, as
 * radios always have. An exact minute waits behind a link, and opens by
 * itself for a time already off the quarter hour.
 */
function TimeGrid({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const parts = toParts(value);
  const set = (patch: Partial<TimeParts>) => onChange(toValue({ ...parts, ...patch }));
  // Once open it stays open, even when a nudge lands on a quarter; picking
  // a quarter folds it away.
  const [exact, setExact] = useState(() => parts.minute % 15 !== 0);
  // Opened from the keyboard, the minute takes focus; a tap leaves the number
  // pad closed until the field is touched.
  const focusMinute = useRef(false);

  return (
    <div
      id={id}
      role="group"
      aria-label={`${label} time`}
      // Room above for the chips' focus rings, which the reveal would clip.
      className="pt-3 space-y-3"
    >
      {/* Spread to the edges, as the day buttons are, so 12 and 5 line up
          with the fields above and the tracks below. */}
      <div role="radiogroup" aria-label="Hour" className="grid grid-cols-[repeat(6,auto)] justify-between gap-y-2">
        {HOURS.map((hour) => {
          const checked = hour === parts.hour12;
          return (
            <label
              key={hour}
              className={cn(
                "w-10 h-10 rounded-full text-sm font-medium tabular-nums flex items-center justify-center cursor-pointer select-none",
                "transition-[transform,background-color,color] duration-150 active:scale-90",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-brand-ink has-[:focus-visible]:ring-offset-[var(--color-bg-elevated)]",
                checked
                  ? "bg-brand text-on-brand"
                  : "bg-bg-secondary text-text-primary hover:bg-surface-hover",
              )}
            >
              <input
                type="radio"
                name={`${id}-hour`}
                checked={checked}
                onChange={() => set({ hour12: hour })}
                className="sr-only"
              />
              {hour}
            </label>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Segmented
          name={`${id}-minute`}
          label="Minutes"
          className="flex-[2]"
          options={MINUTES.map((minute) => ({
            key: minute,
            text: `:${String(minute).padStart(2, "0")}`,
            checked: minute === parts.minute,
            select: () => {
              setExact(false);
              set({ minute });
            },
          }))}
        />
        <Segmented
          name={`${id}-period`}
          label="AM or PM"
          className="flex-1"
          options={[
            { key: "am", text: "AM", checked: !parts.pm, select: () => set({ pm: false }) },
            { key: "pm", text: "PM", checked: parts.pm, select: () => set({ pm: true }) },
          ]}
        />
      </div>

      {exact ? (
        <div role="group" aria-label="Exact minute" className="flex items-center justify-between gap-3">
          <span aria-hidden className="text-sm text-text-secondary">
            Exact minute
          </span>
          <ExactMinute
            minute={parts.minute}
            onChange={(minute) => set({ minute })}
            inputRef={(input) => {
              if (input && focusMinute.current) {
                focusMinute.current = false;
                input.focus();
              }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            // A click the keyboard made has no pointer, and so no count.
            focusMinute.current = e.detail === 0;
            setExact(true);
          }}
          className={cn(
            "min-h-9 rounded-md text-sm font-medium text-brand-ink",
            "hover:underline underline-offset-4",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
          )}
        >
          Exact minute
        </button>
      )}
    </div>
  );
}

/**
 * A minute off the quarter hour, typed or nudged by one. The field rolls as
 * a clock's digits do, so typing 0 then 2 reads :02, and it refuses a minute
 * past 59. The nudges, and the arrow keys, wrap within the hour.
 */
function ExactMinute({
  minute,
  onChange,
  inputRef,
}: {
  minute: number;
  onChange: (minute: number) => void;
  inputRef: (input: HTMLInputElement | null) => void;
}) {
  // What is being typed, while it is; the minute itself otherwise.
  const [draft, setDraft] = useState<string | null>(null);
  const nudge = (by: number) => {
    setDraft(null);
    onChange((minute + by + 60) % 60);
  };

  return (
    <div className="flex items-center gap-1 rounded-lg bg-surface-hover p-1">
      <NudgeButton label="A minute earlier" onClick={() => nudge(-1)}>
        <Minus className="w-4 h-4" aria-hidden />
      </NudgeButton>
      <label
        className={cn(
          "min-h-9 w-16 flex items-center justify-center rounded-md bg-brand text-on-brand shadow-sm cursor-text",
          // Offset by the track's own color: a gold ring on the gold field
          // vanishes at night.
          "focus-within:ring-2 focus-within:ring-brand-ink focus-within:ring-offset-2 focus-within:ring-offset-[var(--color-surface-hover)]",
        )}
      >
        <span aria-hidden className="text-base font-medium">
          :
        </span>
        <input
          ref={inputRef}
          aria-label="Minute"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          autoComplete="off"
          value={draft ?? String(minute).padStart(2, "0")}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(-2);
            if (digits !== "" && Number(digits) > 59) return;
            setDraft(digits);
            if (digits !== "") onChange(Number(digits));
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              nudge(e.key === "ArrowUp" ? 1 : -1);
            } else if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          // 16px: below that, iOS zooms the page in on focus.
          className="w-[2.25ch] bg-transparent text-center text-base font-medium tabular-nums outline-none"
        />
      </label>
      <NudgeButton label="A minute later" onClick={() => nudge(1)}>
        <Plus className="w-4 h-4" aria-hidden />
      </NudgeButton>
    </div>
  );
}

function NudgeButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "w-9 min-h-9 flex items-center justify-center rounded-md text-text-secondary",
        "transition-[transform,color] duration-150 hover:text-text-primary active:scale-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
      )}
    >
      {children}
    </button>
  );
}

/** The app's two-way switch track, as "Who can find it" draws it. */
function Segmented({
  name,
  label,
  options,
  className,
}: {
  name: string;
  label: string;
  options: { key: string | number; text: string; checked: boolean; select: () => void }[];
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex gap-1 rounded-lg bg-surface-hover p-1", className)}
    >
      {options.map((option) => (
        <label
          key={option.key}
          className={cn(
            "flex-1 min-h-9 flex items-center justify-center rounded-md text-sm font-medium tabular-nums cursor-pointer select-none",
            "transition-colors duration-200",
            // Offset by the track: at night the ring is the segment's own gold.
            "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-ink has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-[var(--color-surface-hover)]",
            option.checked
              ? "bg-brand text-on-brand shadow-sm"
              : "text-text-secondary hover:text-text-primary",
          )}
        >
          <input
            type="radio"
            name={name}
            checked={option.checked}
            onChange={option.select}
            className="sr-only"
          />
          {option.text}
        </label>
      ))}
    </div>
  );
}
