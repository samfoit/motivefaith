"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Flame, Trophy } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Pill } from "@/components/ui/Badge";
import type { JourneyHabit } from "@/lib/types/feed";

interface SharedHabitsProps {
  habits: JourneyHabit[];
  friendName: string;
}

/**
 * The shared habits between two friends, as one scrollable line of chips.
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
              aria-label={`${habit.title} — ${habit.isOwner ? "your habit" : `${friendName}'s habit`}, ${habit.completedToday ? "done today" : "not done today"}`}
              className={cn(
                "habit-tint shrink-0 flex items-center gap-1.5 rounded-full border",
                "pl-2.5 pr-3 py-1.5 transition-transform active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              )}
              style={{ ["--habit-color" as string]: habit.color }}
            >
              <span className="text-sm leading-none">{habit.emoji}</span>
              <span className="text-xs font-medium text-text-primary truncate max-w-32">
                {habit.title}
              </span>
              {habit.completedToday ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-success" />
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
                {selected.isOwner ? "Yours" : friendName}
              </Pill>
              <Pill size="sm" variant={selected.completedToday ? "health" : "default"}>
                {selected.completedToday ? "Done today" : "Not done today"}
              </Pill>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Stat
                icon={<Flame className="w-4 h-4 text-streak" />}
                label="Current streak"
                value={selected.streak_current}
              />
              <Stat
                icon={<Trophy className="w-4 h-4 text-brand" />}
                label="Best streak"
                value={selected.streak_best}
              />
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
