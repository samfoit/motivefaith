"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Clock, CloudRain, Flame, Trophy } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { weekdayName } from "@/lib/utils/timezone";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";

/**
 * What a chip needs to render. `JourneyHabit` satisfies it as-is; the group
 * timeline's habit rows satisfy it once the caller works out `isOwner` and
 * names the owner, which a two-person page can leave to context but a group
 * cannot.
 */
export type SharedHabitChip = {
  id: string;
  title: string;
  emoji: string;
  color: string;
  streak_current: number;
  /** Absent where the source query doesn't carry it — the stat is dropped. */
  streak_best?: number;
  isOwner: boolean;
  completedToday: boolean;
  /** On today's list at all: scheduled today, moved here, or already done. */
  dueToday: boolean;
  rainCheckedToday?: boolean;
  /** Where today's rain check was moved to, when it was moved at all. */
  rainCheckMovedTo?: string | null;
  /** Whose it is. Every chip shows its owner's face: the strip mixes
   *  yours with theirs, and which is which is the point of it. */
  ownerName?: string;
  ownerAvatar?: string | null;
};

interface SharedHabitsProps {
  habits: SharedHabitChip[];
  /**
   * Whose the un-owned habits are. A group has no single other party, so it
   * passes `ownerName` on each habit instead.
   */
  friendName?: string;
}

/**
 * Three states, not two: done, deliberately skipped, still open. A rain check
 * reads as its own thing so a partner doesn't mistake it for a missed day.
 */
function dayStatusLabel(habit: {
  completedToday: boolean;
  rainCheckedToday?: boolean;
  rainCheckMovedTo?: string | null;
}): string {
  if (habit.completedToday) return "Done today";
  if (habit.rainCheckedToday) {
    return habit.rainCheckMovedTo
      ? `Moved to ${weekdayName(habit.rainCheckMovedTo)}`
      : "Rain check today";
  }
  return "Not done today";
}

/** Still open first, then rain-checked, then done: what's left leads. */
function dayRank(habit: SharedHabitChip): number {
  if (habit.completedToday) return 2;
  if (habit.rainCheckedToday) return 1;
  return 0;
}

/**
 * Today, at the top of a chat: the shared habits due today, yours and theirs,
 * and whether each is done. The one thing the conversation below can't show
 * is what *hasn't* happened yet, and that is what this strip is for.
 *
 * Only today's: the full list of what's shared, and a group's challenges,
 * are reference, and live behind the chat's name in its info sheet. Hidden
 * when nothing is due. Each chip opens the habit's details.
 */
export function SharedHabits({ habits: allHabits, friendName }: SharedHabitsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const habits = allHabits
    .filter((h) => h.dueToday)
    // Stable: within a rank, theirs before yours — what you're waiting on.
    .sort((a, b) => dayRank(a) - dayRank(b) || Number(a.isOwner) - Number(b.isOwner));
  const selected = habits.find((h) => h.id === openId) ?? null;

  if (habits.length === 0) return null;

  /** "Yours", else the per-habit owner, else the one other person on the page. */
  const ownerLabel = (habit: SharedHabitChip) =>
    habit.isOwner ? "Yours" : habit.ownerName ?? friendName ?? "Shared";

  return (
    <>
      {/* Bleeds into the page gutter so the row can scroll edge to edge */}
      <div className="-mx-4 px-4 overflow-x-auto" aria-label="Today's shared habits" role="group">
        <div className="flex items-center gap-2 w-max">
          {habits.map((habit) => (
            <button
              key={habit.id}
              type="button"
              onClick={() => setOpenId(habit.id)}
              aria-label={`${habit.title} — ${habit.isOwner ? "your habit" : `${habit.ownerName ?? friendName}'s habit`}, ${dayStatusLabel(habit)}`}
              className={cn(
                "habit-tint shrink-0 flex items-center gap-1.5 rounded-full border",
                "pl-2.5 pr-3 py-1.5 transition-transform active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
              )}
              style={{ ["--habit-color" as string]: habit.color }}
            >
              {habit.ownerName && (
                <Avatar
                  src={habit.ownerAvatar}
                  name={habit.ownerName}
                  size="xs"
                  className="shrink-0"
                />
              )}
              <span className="text-sm leading-none">{habit.emoji}</span>
              <span className="text-xs font-medium text-text-primary truncate max-w-32">
                {habit.title}
              </span>
              <DayStatusIcon habit={habit} className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
      </div>

      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        size="md"
        title={
          selected ? (
            <span className="flex items-center gap-2">
              <span>{selected.emoji}</span>
              <span className="truncate">{selected.title}</span>
            </span>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-text-secondary">{ownerLabel(selected)}</span>
              <span
                className={cn(
                  "flex items-center gap-1.5 font-medium",
                  selected.completedToday ? "text-success" : "text-text-secondary",
                )}
              >
                <DayStatusIcon habit={selected} className="w-4 h-4" />
                {dayStatusLabel(selected)}
              </span>
            </div>

            <div
              className={cn(
                "grid gap-3",
                selected.streak_best === undefined ? "grid-cols-1" : "grid-cols-2",
              )}
            >
              <Stat
                icon={<Flame className="w-4 h-4 text-streak" />}
                label="Current streak"
                value={selected.streak_current}
              />
              {selected.streak_best !== undefined && (
                <Stat
                  icon={<Trophy className="w-4 h-4 text-brand-ink" />}
                  label="Best streak"
                  value={selected.streak_best}
                />
              )}
            </div>

            {selected.isOwner && (
              <Link
                href={`/main/habits/${selected.id}`}
                className={cn(
                  "block w-full rounded-lg bg-brand px-4 py-2.5 text-center",
                  "text-sm font-medium text-on-brand transition-colors hover:bg-brand-hover",
                )}
              >
                Open habit
              </Link>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg bg-elevated ring-1 ring-border px-3 py-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-mono text-lg font-semibold text-text-primary">
          {value}
        </span>
      </div>
      <p className="text-xs text-text-tertiary mt-0.5">{label}</p>
    </div>
  );
}

function DayStatusIcon({
  habit,
  className,
}: {
  habit: SharedHabitChip;
  className?: string;
}) {
  if (habit.completedToday) {
    return <CheckCircle2 className={cn("shrink-0 text-success", className)} />;
  }
  if (habit.rainCheckedToday) {
    return (
      <CloudRain
        className={cn("shrink-0", className)}
        style={{ color: "var(--color-rain)" }}
      />
    );
  }
  return <Clock className={cn("shrink-0 text-text-tertiary", className)} />;
}

/**
 * Every shared habit as rows, for a chat's info sheet: reference, not today's
 * status. Your own open their page; with `showOwner`, as in a group, each row
 * names whose it is.
 */
export function SharedHabitRows({
  habits,
  showOwner = false,
}: {
  habits: SharedHabitChip[];
  showOwner?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {habits.map((habit) => {
        const body = (
          <>
            <span className="shrink-0 text-base leading-none">{habit.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text-primary">
                {habit.title}
              </span>
              {showOwner && !habit.isOwner && habit.ownerName && (
                <span className="block truncate text-xs text-text-tertiary">
                  {habit.ownerName}
                </span>
              )}
            </span>
            <span className="shrink-0 flex items-center gap-1 text-xs font-medium text-streak">
              <Flame className="w-3.5 h-3.5" />
              {habit.streak_current}
            </span>
            {habit.isOwner && (
              <ChevronRight className="w-4 h-4 shrink-0 text-text-tertiary" />
            )}
          </>
        );
        const className =
          "habit-tint flex items-center gap-2.5 rounded-lg border px-3 py-2.5";
        const style = { ["--habit-color" as string]: habit.color };
        return habit.isOwner ? (
          <Link
            key={habit.id}
            href={`/main/habits/${habit.id}`}
            className={cn(className, "transition-opacity active:opacity-80")}
            style={style}
          >
            {body}
          </Link>
        ) : (
          <div key={habit.id} className={className} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
