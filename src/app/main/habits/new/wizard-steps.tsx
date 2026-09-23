"use client";

import type React from "react";
import { motion } from "motion/react";
import { Clock, Users, UserPlus, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { FriendPicker } from "@/components/social/FriendPicker";
import { GroupPicker } from "@/components/social/GroupPicker";
import { useFriendsList } from "@/lib/hooks/useFriends";
import { useGroupsList } from "@/lib/hooks/useGroups";
import {
  HABIT_EMOJIS,
  FREQUENCIES,
  DAYS,
  type HabitFrequency,
} from "@/lib/constants/habit";
import { DEFAULT_HABIT_COLOR } from "@/lib/constants/colors";
import { ColorPicker } from "@/components/habits/ColorPicker";
import { VisibilityPicker } from "@/components/habits/VisibilityPicker";
import type { HabitVisibility } from "@/lib/types/partners";

// ---------------------------------------------------------------------------
// Form state type (shared with wizard-client)
// ---------------------------------------------------------------------------

export interface HabitForm {
  title: string;
  emoji: string;
  description: string;
  frequency: HabitFrequency;
  scheduleDays: number[];
  timeWindowEnabled: boolean;
  timeWindowStart: string;
  timeWindowEnd: string;
  color: string | null;
  visibility: HabitVisibility;
  selectedFriends: string[];
  selectedGroups: string[];
}

export const DEFAULT_FORM: HabitForm = {
  title: "",
  emoji: "✅",
  description: "",
  frequency: "daily",
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  timeWindowEnabled: false,
  timeWindowStart: "09:00",
  timeWindowEnd: "12:00",
  color: DEFAULT_HABIT_COLOR,
  visibility: "private",
  selectedFriends: [],
  selectedGroups: [],
};

type UpdateFn = <K extends keyof HabitForm>(key: K, val: HabitForm[K]) => void;

// ---------------------------------------------------------------------------
// Shared: Preview card
// ---------------------------------------------------------------------------

export function PreviewCard({ form }: { form: HabitForm }) {
  return (
    <div
      // Mirrors the dashboard card, tint and all, so the color picker shows
      // what the habit will actually look like.
      className="habit-tint flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm"
      style={{ ["--habit-color" as string]: form.color ?? undefined } as React.CSSProperties}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{form.emoji}</span>
          <h3
            className="font-semibold text-[var(--color-text-primary)] truncate"
            style={{ fontSize: "var(--text-base)" }}
          >
            {form.title || "Habit name"}
          </h3>
        </div>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
          New habit — ready to start
        </p>
      </div>
      <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-gray-300 flex items-center justify-center">
        {/* Empty circle (not completed) */}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-[var(--color-text-secondary)] flex-shrink-0">
        {label}
      </span>
      <span className="text-sm text-[var(--color-text-primary)] text-right">
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Name & Identity
// ---------------------------------------------------------------------------

export function StepName({
  form,
  update,
}: {
  form: HabitForm;
  update: UpdateFn;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2
          className="font-display font-semibold text-[var(--color-text-primary)] mb-1"
          style={{ fontSize: "var(--text-lg)" }}
        >
          What habit do you want to build?
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Give it a name and pick an emoji to make it yours.
        </p>
      </div>

      <Input
        label="Habit name"
        placeholder="e.g. Morning Run, Read 20 Pages"
        value={form.title}
        onChange={(e) => update("title", e.target.value)}
        autoFocus
      />

      {/* Emoji picker */}
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          Choose an icon
        </label>
        <div className="grid grid-cols-10 gap-1.5 p-4">
          {HABIT_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => update("emoji", emoji)}
              className={cn(
                "w-9 h-9 flex items-center justify-center rounded-lg text-lg transition-all",
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
        placeholder="Why is this habit important to you?"
        value={form.description}
        onChange={(e) => update("description", e.target.value)}
        rows={3}
      />

      {/* Live preview */}
      {form.title.trim() && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4"
        >
          <p className="text-xs text-[var(--color-text-tertiary)] mb-2">
            Preview
          </p>
          <PreviewCard form={form} />
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Schedule
// ---------------------------------------------------------------------------

export function StepSchedule({
  form,
  update,
}: {
  form: HabitForm;
  update: UpdateFn;
}) {
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

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="font-display font-semibold text-[var(--color-text-primary)] mb-1"
          style={{ fontSize: "var(--text-lg)" }}
        >
          How often?
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Set a schedule that works for your lifestyle.
        </p>
      </div>

      {/* Frequency chips */}
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
                : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
            )}
          >
            {freq.label}
          </button>
        ))}
      </div>

      {/* Custom day picker */}
      {form.frequency === "specific_days" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
        >
          <label className="text-sm font-medium text-gray-700 mb-2 block">
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
                    : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
                )}
              >
                {day.label}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Time window */}
      <div>
        <button
          type="button"
          onClick={() => update("timeWindowEnabled", !form.timeWindowEnabled)}
          className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Clock className="w-4 h-4" />
          <span>
            {form.timeWindowEnabled
              ? "Remove time window"
              : "Add a time window (optional)"}
          </span>
        </button>

        {form.timeWindowEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="flex items-center gap-3 mt-3"
          >
            <Input
              label="From"
              type="time"
              value={form.timeWindowStart}
              onChange={(e) => update("timeWindowStart", e.target.value)}
              className="flex-1"
            />
            <span className="text-[var(--color-text-tertiary)] mt-5">to</span>
            <Input
              label="Until"
              type="time"
              value={form.timeWindowEnd}
              onChange={(e) => update("timeWindowEnd", e.target.value)}
              className="flex-1"
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Color
// ---------------------------------------------------------------------------

export function StepColor({
  form,
  update,
}: {
  form: HabitForm;
  update: UpdateFn;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2
          className="font-display font-semibold text-[var(--color-text-primary)] mb-1"
          style={{ fontSize: "var(--text-lg)" }}
        >
          Pick a color
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Just so it stands out on your list.
        </p>
      </div>

      <ColorPicker value={form.color} onChange={(c) => update("color", c)} />

      {/* Preview */}
      <div>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-2">
          Preview
        </p>
        <PreviewCard form={form} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Sharing
// ---------------------------------------------------------------------------

export function StepSharing({
  form,
  update,
  userId,
}: {
  form: HabitForm;
  update: UpdateFn;
  userId: string;
}) {
  const { data: friends, isLoading } = useFriendsList(userId);
  const { data: groups, isLoading: groupsLoading } = useGroupsList(userId);

  const toggleFriend = (friendId: string) => {
    update(
      "selectedFriends",
      form.selectedFriends.includes(friendId)
        ? form.selectedFriends.filter((id) => id !== friendId)
        : [...form.selectedFriends, friendId],
    );
  };

  const toggleGroup = (groupId: string) => {
    update(
      "selectedGroups",
      form.selectedGroups.includes(groupId)
        ? form.selectedGroups.filter((id) => id !== groupId)
        : [...form.selectedGroups, groupId],
    );
  };

  const inviteCount = form.selectedFriends.length;

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="font-display font-semibold text-[var(--color-text-primary)] mb-1"
          style={{ fontSize: "var(--text-lg)" }}
        >
          Accountability
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Choose who can find this habit, and who you want watching.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">
          Who can find it
        </p>
        <VisibilityPicker
          value={form.visibility}
          onChange={(v) => update("visibility", v)}
        />
      </div>

      {/* Partners are invited whatever the visibility — private only means
          nobody can stumble across the habit, not that it is unshareable. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-[var(--color-text-secondary)]" />
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            Invite accountability partners
          </p>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">
          They get an invitation to accept or decline. Nobody sees your progress
          until they say yes.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !friends?.length ? (
          <div className="rounded-lg bg-[var(--color-bg-secondary)] p-4">
            <p className="text-sm text-[var(--color-text-secondary)] text-center">
              No friends yet. Add friends from the Friends tab to invite
              partners.
            </p>
          </div>
        ) : (
          <FriendPicker
            friends={friends.map((f) => f.profile)}
            selectedIds={form.selectedFriends}
            onToggle={toggleFriend}
            mode="multi"
            searchPlaceholder="Search friends\u2026"
          />
        )}
      </div>

      {/* Group sharing is a push into a room you are both already in, so it
          needs no invitation. */}
      {!groupsLoading && groups && groups.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--color-text-secondary)]" />
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              Share with groups
            </p>
          </div>
          <GroupPicker
            groups={groups.map((g) => ({
              id: g.id,
              name: g.name,
              avatar_url: g.avatar_url,
              memberCount: g.memberCount,
            }))}
            selectedIds={form.selectedGroups}
            onToggle={toggleGroup}
            searchPlaceholder="Search groups\u2026"
          />
        </div>
      )}

      <p className="text-xs text-[var(--color-text-tertiary)]">
        {inviteCount > 0
          ? `${inviteCount} invitation${inviteCount === 1 ? "" : "s"} will go out when you create the habit.`
          : "You can change any of this later. This step is optional."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Review
// ---------------------------------------------------------------------------

export function StepReview({ form }: { form: HabitForm }) {
  const freqLabel =
    FREQUENCIES.find((f) => f.value === form.frequency)?.label ??
    form.frequency;
  const dayLabels = form.scheduleDays
    .sort((a, b) => a - b)
    .map((d) => DAYS.find((day) => day.value === d)?.full ?? "")
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="font-display font-semibold text-[var(--color-text-primary)] mb-1"
          style={{ fontSize: "var(--text-lg)" }}
        >
          Looking good!
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Review your habit and hit create when you&apos;re ready.
        </p>
      </div>

      {/* Preview card */}
      <PreviewCard form={form} />

      {/* Details summary */}
      <div className="space-y-3">
        <SummaryRow label="Schedule" value={freqLabel} />
        {form.frequency === "specific_days" && (
          <SummaryRow label="Days" value={dayLabels.join(", ")} />
        )}
        {form.timeWindowEnabled && (
          <SummaryRow
            label="Time window"
            value={`${form.timeWindowStart} – ${form.timeWindowEnd}`}
          />
        )}
        <SummaryRow
          label="Visibility"
          value={
            form.visibility === "public"
              ? "Public — friends can find it"
              : "Private — invite only"
          }
        />
        <SummaryRow
          label="Partners"
          value={
            form.selectedFriends.length > 0 || form.selectedGroups.length > 0
              ? [
                  form.selectedFriends.length > 0
                    ? `${form.selectedFriends.length} invite${form.selectedFriends.length === 1 ? "" : "s"}`
                    : null,
                  form.selectedGroups.length > 0
                    ? `${form.selectedGroups.length} group${form.selectedGroups.length === 1 ? "" : "s"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")
              : "None yet"
          }
        />
        {form.description && (
          <SummaryRow label="Description" value={form.description} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Success screen
// ---------------------------------------------------------------------------

const CONFETTI_COLORS = [
  "#6366F1",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#3B82F6",
  "#14B8A6",
];

const CONFETTI_PARTICLES = Array.from({ length: 24 }, (_, i) => ({
  radius: 100 + ((((i * 7 + 13) * 2654435761) >>> 0) % 100) * 0.8,
  duration: 0.8 + ((((i * 11 + 7) * 2654435761) >>> 0) % 100) * 0.004,
  delay: ((((i * 3 + 19) * 2654435761) >>> 0) % 100) * 0.0015,
  angle: (i / 24) * Math.PI * 2,
}));

export function SuccessScreen({ form }: { form: HabitForm }) {
  return (
    <div className="flex items-center justify-center px-4" style={{ minHeight: "calc(100dvh - 3.5rem - 6rem)" }}>
      <div className="text-center relative">
        {/* Confetti particles */}
        {CONFETTI_PARTICLES.map((p, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full left-1/2 top-1/2"
            style={{
              backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            }}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{
              x: Math.cos(p.angle) * p.radius,
              y: Math.sin(p.angle) * p.radius,
              scale: 0,
              opacity: 0,
            }}
            transition={{
              duration: p.duration,
              ease: "easeOut",
              delay: p.delay,
            }}
          />
        ))}

        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="w-20 h-20 rounded-full bg-success flex items-center justify-center mx-auto mb-6"
        >
          <Check className="w-10 h-10 text-white" strokeWidth={3} />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="font-display font-bold text-[var(--color-text-primary)] mb-2"
          style={{ fontSize: "var(--text-xl)" }}
        >
          Habit created!
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="flex items-center justify-center gap-2 text-[var(--color-text-secondary)]"
        >
          <span className="text-2xl">{form.emoji}</span>
          <span className="font-medium">{form.title}</span>
        </motion.div>
      </div>
    </div>
  );
}
