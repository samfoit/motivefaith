"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import * as Switch from "@radix-ui/react-switch";
import { Bell, Clock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
import type { Json } from "@/lib/supabase/types";
import { TimeRangePicker } from "@/components/habits/TimeRangePicker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationPrefs {
  quiet_start: string;
  quiet_end: string;
  completion_alerts: boolean;
  miss_alerts: boolean;
  habit_reminders: boolean;
  encouragement_alerts: boolean;
  partner_alerts: boolean;
  enabled: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  quiet_start: "22:00",
  quiet_end: "07:00",
  completion_alerts: true,
  miss_alerts: true,
  habit_reminders: true,
  encouragement_alerts: true,
  partner_alerts: true,
  enabled: true,
};

function parsePrefs(raw: Json | null): NotificationPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_PREFS;
  const obj = raw as Record<string, unknown>;
  return {
    quiet_start: typeof obj.quiet_start === "string" ? obj.quiet_start : DEFAULT_PREFS.quiet_start,
    quiet_end: typeof obj.quiet_end === "string" ? obj.quiet_end : DEFAULT_PREFS.quiet_end,
    completion_alerts: obj.completion_alerts !== false,
    miss_alerts: obj.miss_alerts !== false,
    habit_reminders: obj.habit_reminders !== false,
    encouragement_alerts: obj.encouragement_alerts !== false,
    // Absent for anyone whose prefs predate the key, which reads as on —
    // matching how the database gates it.
    partner_alerts: obj.partner_alerts !== false,
    enabled: obj.enabled !== false,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2.5 cursor-pointer">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{description}</p>
      </div>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          "w-10 h-6 rounded-full relative transition-colors shrink-0",
          "data-[state=checked]:bg-brand data-[state=unchecked]:bg-[var(--color-bg-secondary)]",
          "disabled:opacity-50",
        )}
      >
        <Switch.Thumb
          className={cn(
            "block w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
            "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-1",
          )}
        />
      </Switch.Root>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface NotificationPreferencesProps {
  notificationPrefs: Json | null;
  /** Called with every edit, so a parent that unmounts this can reseed it. */
  onChange?: (prefs: Json) => void;
  className?: string;
}

export function NotificationPreferences({
  notificationPrefs,
  onChange,
  className,
}: NotificationPreferencesProps) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => parsePrefs(notificationPrefs));
  const [isSaving, setIsSaving] = useState(false);

  const pendingRef = useRef<NotificationPrefs | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async (updated: NotificationPrefs) => {
    setIsSaving(true);
    try {
      const supabase = createClient();
      // RPC not yet in the auto-generated types (added in the 010_notifications
      // migration); untypedRpc keeps the assertion in one place.
      await untypedRpc<void>(supabase, "update_own_notification_prefs", {
        p_prefs: updated,
      });
    } catch (err) {
      console.error("Failed to save notification preferences:", err);
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Flush any pending save on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current) flush(pendingRef.current);
    };
  }, [flush]);

  const save = useCallback((updated: NotificationPrefs) => {
    onChange?.(updated as unknown as Json);
    pendingRef.current = updated;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = null;
      flush(updated);
    }, 500);
  }, [flush, onChange]);

  const update = useCallback(
    (patch: Partial<NotificationPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        save(next);
        return next;
      });
    },
    [save],
  );

  return (
    <div className={cn("rounded-lg bg-elevated p-4 shadow-sm space-y-1", className)}>
      <div className="flex items-center gap-2 mb-2">
        <Bell className="w-4 h-4 text-brand-ink" />
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          Notification Settings
        </span>
        {isSaving && (
          <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">Saving...</span>
        )}
      </div>

      <ToggleRow
        label="Habit Reminders"
        description="Get reminded when it's time for a habit"
        checked={prefs.habit_reminders}
        onCheckedChange={(v) => update({ habit_reminders: v })}
      />

      <ToggleRow
        label="Friend Completions"
        description="When someone you partner with checks in"
        checked={prefs.completion_alerts}
        onCheckedChange={(v) => update({ completion_alerts: v })}
      />

      <ToggleRow
        label="Missed Habits"
        description="When someone you partner with misses a day"
        checked={prefs.miss_alerts}
        onCheckedChange={(v) => update({ miss_alerts: v })}
      />

      <ToggleRow
        label="Messages"
        description="When friends send you messages"
        checked={prefs.encouragement_alerts}
        onCheckedChange={(v) => update({ encouragement_alerts: v })}
      />

      <ToggleRow
        label="Partner Requests"
        description="Invitations to follow a habit, and replies to yours"
        checked={prefs.partner_alerts}
        onCheckedChange={(v) => update({ partner_alerts: v })}
      />

      <div className="border-t border-surface-hover pt-3 mt-3">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">
            Quiet Hours
          </span>
        </div>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-2">
          No notifications during these hours
        </p>
        {/* The habit form's own picker. Quiet hours usually run past
            midnight, so To before From is the normal case here. */}
        <TimeRangePicker
          start={prefs.quiet_start}
          end={prefs.quiet_end}
          onChange={({ start, end }) => update({ quiet_start: start, quiet_end: end })}
          labels={{ start: "From", end: "To" }}
          overnight
        />
      </div>
    </div>
  );
}
