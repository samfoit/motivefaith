"use client";

import React, { useState, useMemo, useCallback } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import {
  HABIT_EMOJIS,
  CATEGORIES,
  FREQUENCIES,
  DAYS,
  type HabitFrequency,
} from "@/lib/constants/habit";
import { getScheduledDays, parseTimeWindow as parseTimeWindowJson } from "@/lib/utils/schedule";
import type { Tables } from "@/lib/supabase/types";
import type { ToastVariant } from "@/components/ui/Toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Habit = Tables<"habits">;

export interface EditHabitSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: Habit;
  onSaved: (updates: Partial<Habit>) => void;
  showToast: (opts: { variant?: ToastVariant; title?: React.ReactNode }) => void;
}

interface EditForm {
  title: string;
  emoji: string;
  description: string;
  frequency: HabitFrequency;
  scheduleDays: number[];
  timeWindowEnabled: boolean;
  timeWindowStart: string;
  timeWindowEnd: string;
  category: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTimeWindowForm(tw: unknown): {
  enabled: boolean;
  start: string;
  end: string;
} {
  const parsed = parseTimeWindowJson(tw);
  if (parsed?.start || parsed?.end) {
    return {
      enabled: true,
      start: parsed.start ?? "09:00",
      end: parsed.end ?? "12:00",
    };
  }
  return { enabled: false, start: "09:00", end: "12:00" };
}

function buildFormFromHabit(habit: Habit): EditForm {
  const tw = parseTimeWindowForm(habit.time_window);
  return {
    title: habit.title,
    emoji: habit.emoji ?? "✅",
    description: habit.description ?? "",
    frequency: habit.frequency,
    scheduleDays: getScheduledDays(habit.schedule),
    timeWindowEnabled: tw.enabled,
    timeWindowStart: tw.start,
    timeWindowEnd: tw.end,
    category: habit.category ?? "general",
    color: habit.color ?? "#6366F1",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditHabitSheet({
  open,
  onOpenChange,
  habit,
  onSaved,
  showToast,
}: EditHabitSheetProps) {
  const initial = useMemo(() => buildFormFromHabit(habit), [habit]);
  const [form, setForm] = useState<EditForm>(initial);
  const [isSaving, setIsSaving] = useState(false);

  // Reset form when habit changes (e.g. sheet reopened with fresh data)
  React.useEffect(() => {
    if (open) {
      setForm(buildFormFromHabit(habit));
    }
  }, [open, habit]);

  const update = useCallback(
    <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const isDirty = useMemo(() => {
    return (
      form.title !== initial.title ||
      form.emoji !== initial.emoji ||
      form.description !== initial.description ||
      form.frequency !== initial.frequency ||
      form.category !== initial.category ||
      form.color !== initial.color ||
      form.timeWindowEnabled !== initial.timeWindowEnabled ||
      form.timeWindowStart !== initial.timeWindowStart ||
      form.timeWindowEnd !== initial.timeWindowEnd ||
      JSON.stringify(form.scheduleDays.slice().sort()) !==
      JSON.stringify(initial.scheduleDays.slice().sort())
    );
  }, [form, initial]);

  const canSave = form.title.trim().length > 0 && form.scheduleDays.length > 0;

  const handleSave = async () => {
    if (!isDirty || !canSave) return;
    setIsSaving(true);

    const updates: Record<string, unknown> = {
      title: form.title.trim(),
      emoji: form.emoji,
      description: form.description.trim() || null,
      frequency: form.frequency,
      schedule: { days: form.scheduleDays },
      time_window: form.timeWindowEnabled
        ? { start: form.timeWindowStart, end: form.timeWindowEnd }
        : null,
      category: form.category,
      color: form.color,
    };

    const supabase = createClient();
    const { error } = await supabase
      .from("habits")
      .update(updates)
      .eq("id", habit.id);

    if (error) {
      showToast({ variant: "error", title: "Failed to update habit" });
    } else {
      onSaved(updates as Partial<Habit>);
      showToast({ variant: "success", title: "Habit updated" });
      onOpenChange(false);
    }
    setIsSaving(false);
  };

  const handleFrequency = (freq: (typeof FREQUENCIES)[number]) => {
    update("frequency", freq.value);
    if (freq.days) {
      update("scheduleDays", freq.days);
    }
  };

  const toggleDay = (day: number) => {
    const next = form.scheduleDays.includes(day)
      ? form.scheduleDays.filter((d) => d !== day)
      : [...form.scheduleDays, day];
    update("scheduleDays", next);
  };

  const selectCategory = (cat: (typeof CATEGORIES)[number]) => {
    update("category", cat.id);
    update("color", cat.color);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit habit"
      size="lg"
      className="bg-bg-elevated"
    >
      <div className="space-y-8 pb-4">
        {/* ---- Name & Icon ---- */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium text-text-secondary">
            Name & Icon
          </h3>

          <Input
            label="Habit name"
            placeholder="e.g. Morning Run, Read 20 Pages"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
          />

          <div>
            <label className="text-sm font-medium text-text-secondary mb-2 block">
              Icon
            </label>
            <div className="grid grid-cols-10 gap-1.5">
              {HABIT_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => update("emoji", emoji)}
                  className={cn(
                    "w-9 h-9 flex items-center justify-center rounded-lg text-lg transition-all",
                    form.emoji === emoji
                      ? "bg-brand-light ring-2 ring-brand scale-110"
                      : "hover:bg-surface-hover",
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <TextArea
            label="Description (optional)"
            placeholder="Why is this habit important to you?"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            rows={3}
          />
        </section>

        {/* ---- Schedule ---- */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium text-text-secondary">
            Schedule
          </h3>

          <div className="flex flex-wrap gap-2">
            {FREQUENCIES.map((freq) => (
              <button
                key={freq.value}
                type="button"
                onClick={() => handleFrequency(freq)}
                className={cn(
                  "px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                  form.frequency === freq.value
                    ? "bg-brand text-white shadow-sm"
                    : "bg-bg-secondary text-text-primary hover:bg-surface-hover",
                )}
              >
                {freq.label}
              </button>
            ))}
          </div>

          {form.frequency === "specific_days" && (
            <div>
              <label className="text-sm font-medium text-text-secondary mb-2 block">
                Which days?
              </label>
              <div className="flex gap-2 justify-between">
                {DAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    aria-label={day.full}
                    className={cn(
                      "w-10 h-10 rounded-full text-sm font-medium transition-all flex items-center justify-center",
                      form.scheduleDays.includes(day.value)
                        ? "bg-brand text-white"
                        : "bg-bg-secondary text-text-primary hover:bg-surface-hover",
                    )}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Time window */}
          <div>
            <button
              type="button"
              onClick={() =>
                update("timeWindowEnabled", !form.timeWindowEnabled)
              }
              className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <Clock className="w-4 h-4" />
              <span>
                {form.timeWindowEnabled
                  ? "Remove time window"
                  : "Add a time window (optional)"}
              </span>
            </button>

            {form.timeWindowEnabled && (
              <div className="flex items-center gap-3 mt-3">
                <Input
                  label="From"
                  type="time"
                  value={form.timeWindowStart}
                  onChange={(e) => update("timeWindowStart", e.target.value)}
                  className="flex-1"
                />
                <span className="text-text-tertiary mt-5">
                  to
                </span>
                <Input
                  label="Until"
                  type="time"
                  value={form.timeWindowEnd}
                  onChange={(e) => update("timeWindowEnd", e.target.value)}
                  className="flex-1"
                />
              </div>
            )}
          </div>
        </section>

        {/* ---- Category & Color ---- */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium text-text-secondary">
            Category & Color
          </h3>

          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => selectCategory(cat)}
                className={cn(
                  "flex items-center gap-3 p-4 rounded-lg transition-all text-left",
                  form.category === cat.id
                    ? "ring-2 bg-elevated shadow-sm"
                    : "bg-bg-secondary hover:bg-surface-hover",
                )}
                style={{
                  outline:
                    form.category === cat.id
                      ? `2px solid ${cat.color}`
                      : undefined,
                  outlineOffset:
                    form.category === cat.id ? "-2px" : undefined,
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${cat.color}15` }}
                >
                  <cat.Icon
                    className="w-5 h-5"
                    style={{ color: cat.color }}
                  />
                </div>
                <span className="text-sm font-medium text-text-primary">
                  {cat.label}
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <label
              htmlFor="edit-color-picker"
              className="text-sm text-text-secondary"

            >
              Custom color
            </label>
            <div className="relative">
              <input
                id="edit-color-picker"
                type="color"
                value={form.color}
                onChange={(e) => update("color", e.target.value)}
                className="w-8 h-8 rounded-lg border-none cursor-pointer appearance-none bg-transparent [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch-wrapper]:p-0"
              />
            </div>
            <span className="text-xs font-mono text-text-tertiary">
              {form.color}
            </span>
          </div>
        </section>

        {/* ---- Save ---- */}
        <Button
          className="w-full"
          onClick={handleSave}
          disabled={!isDirty || !canSave || isSaving}
          loading={isSaving}
          size="lg"
        >
          Save changes
        </Button>
      </div>
    </Sheet>
  );
}
