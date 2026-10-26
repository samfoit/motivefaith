"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as Switch from "@radix-ui/react-switch";
import { Clock, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The settings most habits leave alone, as one group of rows in the iOS
 * manner: each shows its value and opens only when touched. The same rows in
 * the new-habit wizard and the edit sheet, with RepeatPicker leading.
 */

export const SETTINGS_ROW = "min-h-12 flex items-center gap-3 px-4 py-3";
export const SETTINGS_ROW_ICON = "w-4 h-4 shrink-0 text-text-secondary";

const EASE = [0.16, 1, 0.3, 1] as const;

export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-elevated border border-border divide-y divide-border overflow-hidden">
      {children}
    </div>
  );
}

/** The switch at the end of a row. Named by the row's own label. */
export function RowSwitch({
  checked,
  onCheckedChange,
  describedBy,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The id of a footnote that explains the setting. */
  describedBy?: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-describedby={describedBy}
      className={cn(
        "w-10 h-6 rounded-full relative transition-colors shrink-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-ink focus-visible:ring-offset-[var(--color-bg-elevated)]",
        // The track's own color when off: the tile color is all but the
        // card's, and the white thumb vanished into it.
        "data-[state=checked]:bg-brand data-[state=unchecked]:bg-surface-hover",
      )}
    >
      <Switch.Thumb
        className={cn(
          "block w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
          "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-1",
        )}
      />
    </Switch.Root>
  );
}

interface TimeWindowRowProps {
  enabled: boolean;
  start: string;
  end: string;
  onEnabledChange: (enabled: boolean) => void;
  onStartChange: (start: string) => void;
  onEndChange: (end: string) => void;
  /** The days on the usual time, named once some days have their own. */
  usualLabel?: string;
  /** The days with a different time, below the usual one. */
  children?: ReactNode;
}

/**
 * A switch, and the window's two ends once it is on — then whatever days
 * keep a different time.
 */
export function TimeWindowRow({
  enabled,
  start,
  end,
  onEnabledChange,
  onStartChange,
  onEndChange,
  usualLabel,
  children,
}: TimeWindowRowProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div>
      <label className={cn(SETTINGS_ROW, "cursor-pointer")}>
        <Clock className={SETTINGS_ROW_ICON} aria-hidden />
        <span className="flex-1 text-base text-text-primary">Time window</span>
        <RowSwitch checked={enabled} onCheckedChange={onEnabledChange} />
      </label>

      <AnimatePresence initial={false}>
        {enabled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <div role={usualLabel ? "group" : undefined} aria-label={usualLabel}>
              {usualLabel && (
                <p className="px-4 pb-2 -mt-1 text-xs font-medium text-text-secondary" aria-hidden>
                  {usualLabel}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 px-4 pb-3">
                <TimeField label="From" value={start} onChange={onStartChange} />
                <TimeField label="Until" value={end} onChange={onEndChange} />
              </div>
            </div>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    // The label sits over the value, not beside it: side by side there was no
    // room left for "AM" next to the browser's own clock button.
    <label className="flex flex-col rounded-md bg-bg-secondary px-3 py-1.5 focus-within:ring-2 focus-within:ring-brand-ink">
      <span className="text-xs text-text-secondary">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full min-w-0 appearance-none bg-transparent text-base leading-6 text-text-primary outline-none",
          "[&::-webkit-date-and-time-value]:text-left",
          // The page says light and dark both work, so the browser draws
          // native parts for the OS's scheme, not the hour's: a dark clock
          // icon on the night card.
          "[[data-theme=dark]_&]:[color-scheme:dark]",
        )}
      />
    </label>
  );
}

/**
 * The habit's description, the reason behind it, as one line that grows with
 * what is typed. A box sized for a paragraph asked for one; most habits are
 * fine without. Named for what it holds rather than "note", which is already
 * a kind of check-in.
 *
 * Meant as the last row of its group: the focus ring takes the group's
 * corners.
 */
export function WhyRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <label
      className={cn(
        SETTINGS_ROW,
        "items-start cursor-text rounded-b-lg",
        "focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand-ink",
      )}
    >
      <NotebookPen className={cn(SETTINGS_ROW_ICON, "mt-1")} aria-hidden />
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Why it matters"
        placeholder="Why it matters to you"
        className="flex-1 min-w-0 resize-none bg-transparent text-base leading-6 text-text-primary placeholder:text-text-tertiary outline-none"
      />
    </label>
  );
}
