"use client";

import React, { useState, useMemo, useCallback, useId } from "react";
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { sendOrQueue } from "@/lib/offline-write";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import {
  HabitFields,
  LiveHabitCard,
  PRIMARY_ACTION,
  PRIMARY_ACTION_UNAVAILABLE,
  SECTION_LABEL,
  type HabitFieldValues,
} from "@/components/habits/HabitFields";
import {
  RowSwitch,
  SETTINGS_ROW,
  SETTINGS_ROW_ICON,
  SettingsGroup,
} from "@/components/habits/HabitSettingsRows";
import { VisibilityPicker } from "@/components/habits/VisibilityPicker";
import type { HabitVisibility } from "@/lib/types/partners";
import {
  buildTimeWindow,
  getScheduledDays,
  timeFieldsFromWindow,
  timeWindowsInOrder,
} from "@/lib/utils/schedule";
import type { Habit } from "@/lib/types/habit";
import type { TablesUpdate } from "@/lib/supabase/types";
import type { ToastVariant } from "@/components/ui/Toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditHabitSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: Habit;
  onSaved: (updates: Partial<Habit>) => void;
  showToast: (opts: { variant?: ToastVariant; title?: React.ReactNode }) => void;
}

/** The habit's own fields (shared with the new-habit wizard), and sharing. */
interface EditForm extends HabitFieldValues {
  visibility: HabitVisibility;
  privateCheckins: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFormFromHabit(habit: Habit): EditForm {
  const scheduleDays = getScheduledDays(habit.schedule);
  return {
    title: habit.title,
    emoji: habit.emoji ?? "✅",
    description: habit.description ?? "",
    frequency: habit.frequency,
    scheduleDays,
    ...timeFieldsFromWindow(habit.time_window, scheduleDays),
    color: habit.color ?? null,
    visibility: habit.visibility,
    privateCheckins: habit.private_checkins,
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

  // Reset form when habit changes (e.g. sheet reopened with fresh data).
  // Adjusted during render rather than in an effect, so the sheet never
  // paints one frame of the previous edit.
  const [formSync, setFormSync] = useState({ open, habit });
  if (formSync.open !== open || formSync.habit !== habit) {
    setFormSync({ open, habit });
    if (open) setForm(initial);
  }

  const change = useCallback((patch: Partial<EditForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const privateHintId = useId();

  const isDirty = useMemo(() => {
    return (
      form.title !== initial.title ||
      form.emoji !== initial.emoji ||
      form.description !== initial.description ||
      form.frequency !== initial.frequency ||
      form.color !== initial.color ||
      form.visibility !== initial.visibility ||
      form.privateCheckins !== initial.privateCheckins ||
      // As it would be stored, so adding a different time and leaving it on
      // the usual one is no change.
      JSON.stringify(buildTimeWindow(form)) !== JSON.stringify(buildTimeWindow(initial)) ||
      JSON.stringify(form.scheduleDays.slice().sort()) !==
      JSON.stringify(initial.scheduleDays.slice().sort())
    );
  }, [form, initial]);

  const canSave =
    form.title.trim().length > 0 && form.scheduleDays.length > 0 && timeWindowsInOrder(form);

  const handleSave = async () => {
    if (!isDirty || !canSave) return;
    setIsSaving(true);

    const updates: TablesUpdate<"habits"> = {
      title: form.title.trim(),
      emoji: form.emoji,
      description: form.description.trim() || null,
      frequency: form.frequency,
      schedule: { days: form.scheduleDays },
      time_window: buildTimeWindow(form),
      color: form.color,
      visibility: form.visibility,
      private_checkins: form.privateCheckins,
    };

    const supabase = createClient();

    try {
      const result = await sendOrQueue(
        {
          // The outbox row's own id — an edit creates no row, so this just
          // identifies the queued write.
          id: crypto.randomUUID(),
          kind: "habit.update",
          userId: habit.user_id,
          // A patch, not the whole row: replaying a queued edit then only
          // overwrites the fields the user actually touched, so it cannot
          // clobber a change made elsewhere in the meantime.
          payload: { habitId: habit.id, patch: updates },
        },
        async () => {
          const { error } = await supabase
            .from("habits")
            .update(updates)
            .eq("id", habit.id);
          if (error) throw error;
          return { queued: false as const };
        },
      );

      onSaved(updates as Partial<Habit>);
      showToast(
        "queued" in result && result.queued
          ? { variant: "success", title: "Saved offline — syncs when you reconnect" }
          : { variant: "success", title: "Habit updated" },
      );
      onOpenChange(false);
    } catch {
      showToast({ variant: "error", title: "Failed to update habit" });
    }
    setIsSaving(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit habit"
      size="lg"
      className="bg-bg-elevated"
    >
      <div className="space-y-6 pb-4">
        {/* The same card and fields as the new-habit wizard's, so editing a
            habit works the way creating it did. */}
        <LiveHabitCard form={form} onChange={change} />
        <HabitFields form={form} onChange={change} />

        {/* ---- Visibility ---- */}
        {/* Changing this does not touch existing partners: they accepted a
            partnership, not a visibility setting, and going private should not
            silently throw them out. */}
        <section>
          <p className={SECTION_LABEL}>Who can find it</p>
          <VisibilityPicker
            variant="segmented"
            value={form.visibility}
            onChange={(visibility) => change({ visibility })}
          />
        </section>

        {/* ---- Check-in content ---- */}
        {/* Only the default: each check-in can still flip it on its own. */}
        <section>
          <p className={SECTION_LABEL}>What partners see</p>
          <SettingsGroup>
            <label className={cn(SETTINGS_ROW, "cursor-pointer")}>
              <EyeOff className={SETTINGS_ROW_ICON} aria-hidden />
              <span className="flex-1 min-w-0 text-base text-text-primary">
                Keep check-in content private
              </span>
              <RowSwitch
                checked={form.privateCheckins}
                onCheckedChange={(privateCheckins) => change({ privateCheckins })}
                describedBy={privateHintId}
              />
            </label>
          </SettingsGroup>
          <p id={privateHintId} className="mt-2 text-xs text-text-secondary text-pretty">
            Notes, photos, videos and voice clips stay in your history. Partners
            just see that you checked in.
          </p>
        </section>

        {/* ---- Save ---- */}
        <Button
          className={cn(
            PRIMARY_ACTION,
            !(isDirty && canSave) && PRIMARY_ACTION_UNAVAILABLE,
          )}
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
