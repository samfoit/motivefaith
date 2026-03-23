"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import {
  HABIT_EMOJIS,
  CATEGORIES,
  FREQUENCIES,
  DAYS,
} from "@/lib/constants/habit";
import type { Database } from "@/lib/supabase/types";

type HabitFrequency = Database["public"]["Enums"]["habit_frequency"];

interface CreateChallengeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ChallengeFormData) => Promise<void>;
}

export type ChallengeFormData = {
  title: string;
  emoji: string;
  description: string;
  color: string;
  category: string;
  frequency: HabitFrequency;
  scheduleDays: number[];
  startDate: string;
  endDate: string;
};

export function CreateChallengeSheet({
  open,
  onOpenChange,
  onSubmit,
}: CreateChallengeSheetProps) {
  const [form, setForm] = useState<ChallengeFormData>({
    title: "",
    emoji: "🎯",
    description: "",
    color: "#6366F1",
    category: "general",
    frequency: "daily",
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = <K extends keyof ChallengeFormData>(
    key: K,
    value: ChallengeFormData[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) return;
    setIsSubmitting(true);
    try {
      await onSubmit(form);
      onOpenChange(false);
      // Reset form
      setForm({
        title: "",
        emoji: "🎯",
        description: "",
        color: "#6366F1",
        category: "general",
        frequency: "daily",
        scheduleDays: [0, 1, 2, 3, 4, 5, 6],
        startDate: new Date().toISOString().slice(0, 10),
        endDate: "",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} size="lg" showHandle>
      <div className="px-4 py-2 space-y-4 overflow-y-auto max-h-[80vh]">
        <h2
          className="font-display font-bold text-[var(--color-text-primary)]"
          style={{ fontSize: "var(--text-lg)" }}
        >
          New Challenge
        </h2>

        <Input
          label="Challenge name"
          placeholder="e.g. 30-Day Push-up Challenge"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          autoFocus
        />

        {/* Emoji picker (compact) */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 block">
            Icon
          </label>
          <div className="flex flex-wrap gap-1.5">
            {HABIT_EMOJIS.slice(0, 20).map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => update("emoji", emoji)}
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-lg text-base transition-all",
                  form.emoji === emoji
                    ? "bg-brand-light ring-2 ring-brand scale-110"
                    : "hover:bg-[var(--color-surface-hover)]",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <TextArea
          label="Description (optional)"
          placeholder="What's this challenge about?"
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={2}
        />

        {/* Category */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 block">
            Category
          </label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  update("category", cat.id);
                  update("color", cat.color);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  form.category === cat.id
                    ? "bg-brand text-white"
                    : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Frequency */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-secondary)] mb-2 block">
            Frequency
          </label>
          <div className="flex flex-wrap gap-2">
            {FREQUENCIES.map((freq) => (
              <button
                key={freq.value}
                type="button"
                onClick={() => {
                  update("frequency", freq.value);
                  if (freq.days) update("scheduleDays", freq.days);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  form.frequency === freq.value
                    ? "bg-brand text-white"
                    : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
                )}
              >
                {freq.label}
              </button>
            ))}
          </div>

          {form.frequency === "specific_days" && (
            <div className="flex gap-2 justify-between mt-3">
              {DAYS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => {
                    const next = form.scheduleDays.includes(day.value)
                      ? form.scheduleDays.filter((d) => d !== day.value)
                      : [...form.scheduleDays, day.value];
                    update("scheduleDays", next);
                  }}
                  className={cn(
                    "w-8 h-8 rounded-full text-xs font-medium transition-all flex items-center justify-center",
                    form.scheduleDays.includes(day.value)
                      ? "bg-brand text-white"
                      : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]",
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dates */}
        <div className="flex gap-3">
          <Input
            label="Start date"
            type="date"
            value={form.startDate}
            onChange={(e) => update("startDate", e.target.value)}
            className="flex-1"
          />
          <Input
            label="End date (optional)"
            type="date"
            value={form.endDate}
            onChange={(e) => update("endDate", e.target.value)}
            className="flex-1"
          />
        </div>

        <Button
          className="w-full"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={!form.title.trim() || isSubmitting}
        >
          Create Challenge
        </Button>
      </div>
    </Sheet>
  );
}
