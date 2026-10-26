"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { HabitFrequency } from "@/lib/constants/habit";
import {
  describeDays,
  formatStartTime,
  settleTimeFields,
  shownExceptions,
  usualDays,
  type TimeException,
} from "@/lib/utils/schedule";
import { ColorPicker } from "@/components/habits/ColorPicker";
import { IconPicker } from "@/components/habits/IconPicker";
import { RepeatPicker } from "@/components/habits/RepeatPicker";
import {
  SettingsGroup,
  TimeWindowRow,
  WhyRow,
} from "@/components/habits/HabitSettingsRows";
import { TimeWindowExceptions } from "@/components/habits/TimeWindowExceptions";
import { HabitCircle, habitSurfaceProps } from "@/components/habits/HabitCardParts";

/**
 * The habit itself, as both the new-habit wizard and the edit sheet ask for
 * it: one form, so creating a habit and changing it look and work the same,
 * and a change to either is a change to both.
 */
export interface HabitFieldValues {
  title: string;
  emoji: string;
  description: string;
  frequency: HabitFrequency;
  scheduleDays: number[];
  timeWindowEnabled: boolean;
  timeWindowStart: string;
  timeWindowEnd: string;
  /** Days that keep a different time from the usual one. */
  timeWindowExceptions: TimeException[];
  color: string | null;
}

type Change = (patch: Partial<HabitFieldValues>) => void;

/** One look for every section label, matching the icon and color rows'. */
export const SECTION_LABEL = "text-xs font-medium text-text-secondary mb-2";

/**
 * The form's one button, full width. A disabled one is opaque and the track
 * color rather than faded gold: faded, it let whatever was behind it show
 * through (the sky, on the wizard's see-through bar) and read as nearly ready.
 * A busy one stays gold, with its spinner.
 */
export const PRIMARY_ACTION = "w-full disabled:opacity-100";
export const PRIMARY_ACTION_UNAVAILABLE =
  "disabled:bg-surface-hover disabled:text-text-tertiary";

/**
 * The dashboard card itself, built from the same parts, with the name typed
 * straight into it.
 *
 * It replaces a name field and a preview of the card: one card that is the
 * field and the preview at once, so every pick below it shows where it lands.
 * The circle is drawn, not wired: there is nothing to complete here. The
 * drawer's handle is left out for the same reason, so the icon sits on the
 * gutter.
 */
export function LiveHabitCard({
  form,
  onChange,
  autoFocus = false,
}: {
  form: HabitFieldValues;
  onChange: Change;
  /** For a new habit, where the name is the first thing asked. */
  autoFocus?: boolean;
}) {
  const time = form.timeWindowEnabled
    ? formatStartTime(form.timeWindowStart)
    : null;

  return (
    <div
      {...habitSurfaceProps(form.color, {
        className: "pl-4 focus-within:ring-2 focus-within:ring-brand-ink",
      })}
    >
      <span className="text-xl leading-none shrink-0" aria-hidden>
        {form.emoji}
      </span>
      <div className="flex-1 min-w-0">
        <input
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onKeyDown={(e) => {
            // Return puts the keyboard away rather than submitting: the rest
            // of the form is right below.
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          aria-label="Habit name"
          placeholder="Name your habit"
          enterKeyHint="done"
          autoComplete="off"
          autoFocus={autoFocus}
          className={cn(
            "w-full bg-transparent font-semibold leading-6 text-text-primary outline-none",
            "placeholder:font-medium placeholder:text-text-tertiary",
          )}
          // 16px, as on the dashboard — and below that iOS zooms in on focus.
          style={{ fontSize: "var(--text-base)" }}
        />
        {time && (
          <span className="text-xs text-text-secondary flex items-center gap-0.5 mt-0.5">
            <Clock className="w-3 h-3" aria-hidden />
            {time}
          </span>
        )}
      </div>
      <HabitCircle state="open" />
    </div>
  );
}

/**
 * Everything below the card. The two pickers that shape the card come first;
 * the settings most habits leave alone sit in one group of rows, each showing
 * its value and opening only when touched.
 */
export function HabitFields({
  form,
  onChange,
}: {
  form: HabitFieldValues;
  onChange: Change;
}) {
  const hasExceptions = shownExceptions(form).length > 0;

  return (
    <div className="space-y-6">
      <IconPicker value={form.emoji} onChange={(emoji) => onChange({ emoji })} />

      <ColorPicker value={form.color} onChange={(color) => onChange({ color })} />

      <SettingsGroup>
        <RepeatPicker
          frequency={form.frequency}
          days={form.scheduleDays}
          onChange={(frequency, scheduleDays) => {
            // Taking days out of Repeat can leave the usual time on none.
            const settled = settleTimeFields({ ...form, frequency, scheduleDays });
            onChange({
              frequency,
              scheduleDays,
              timeWindowEnabled: settled.timeWindowEnabled,
              timeWindowStart: settled.timeWindowStart,
              timeWindowEnd: settled.timeWindowEnd,
              timeWindowExceptions: settled.timeWindowExceptions,
            });
          }}
        />
        <TimeWindowRow
          enabled={form.timeWindowEnabled}
          start={form.timeWindowStart}
          end={form.timeWindowEnd}
          onEnabledChange={(timeWindowEnabled) => onChange({ timeWindowEnabled })}
          onStartChange={(timeWindowStart) => onChange({ timeWindowStart })}
          onEndChange={(timeWindowEnd) => onChange({ timeWindowEnd })}
          usualLabel={hasExceptions ? describeDays(usualDays(form)) : undefined}
        >
          <TimeWindowExceptions
            fields={form}
            onChange={(timeWindowExceptions) => onChange({ timeWindowExceptions })}
          />
        </TimeWindowRow>
        <WhyRow
          value={form.description}
          onChange={(description) => onChange({ description })}
        />
      </SettingsGroup>
    </div>
  );
}
