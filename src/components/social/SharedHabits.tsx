"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, CloudRain, Flame, Trophy } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { weekdayName } from "@/lib/utils/timezone";
import { Sheet } from "@/components/ui/Sheet";
import { Pill } from "@/components/ui/Badge";
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
  rainCheckedToday?: boolean;
  /** Where today's rain check was moved to, when it was moved at all. */
  rainCheckMovedTo?: string | null;
  /** Named per habit on a page with more than two people in it. */
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

/**
 * Shared habits as one scrollable line of chips — used by both the friend
 * journey and the group timeline, which rendered its own stack of full-width
 * cards until this replaced it.
 *
 * They used to be full-width cards — three of them pushed the first message
 * most of the way down the screen, on a page people open to read messages.
 * The chip carries what is worth knowing at a glance (whose habit, and
 * whether it is done today); everything else lives one tap away in the sheet.
 */
export function SharedHabits({ habits, friendName }: SharedHabitsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = habits.find((h) => h.id === openId) ?? null;

  if (habits.length === 0) return null;

  /** "Yours", else the per-habit owner, else the one other person on the page. */
  const ownerLabel = (habit: SharedHabitChip) =>
    habit.isOwner ? "Yours" : habit.ownerName ?? friendName ?? "Shared";

  return (
    <>
      {/* Bleeds into the page gutter so the row can scroll edge to edge */}
      <div className="-mx-4 px-4 overflow-x-auto">
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
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              )}
              style={{ ["--habit-color" as string]: habit.color }}
            >
              {/* In a group, whose habit it is cannot be read from context
                  the way it can on a two-person page. */}
              {!habit.isOwner && habit.ownerName && (
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
              {habit.completedToday ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-success" />
              ) : habit.rainCheckedToday ? (
                <CloudRain
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: "var(--color-rain)" }}
                />
              ) : (
                <Clock className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
              )}
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
            <div className="flex flex-wrap items-center gap-2">
              <Pill size="sm" variant={selected.isOwner ? "productivity" : "social"}>
                {ownerLabel(selected)}
              </Pill>
              <Pill size="sm" variant={selected.completedToday ? "health" : "default"}>
                {dayStatusLabel(selected)}
              </Pill>
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
                  icon={<Trophy className="w-4 h-4 text-brand" />}
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
                  "text-sm font-medium text-white transition-colors hover:bg-brand-hover",
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
    <div className="rounded-lg bg-bg-secondary px-3 py-2">
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
