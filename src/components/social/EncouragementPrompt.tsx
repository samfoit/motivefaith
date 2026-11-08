"use client";

import { useId, useMemo, useState } from "react";
import { HandHeart, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  LateHabitRow,
  PersonLateHabits,
  byPerson,
} from "@/components/social/LateHabitRow";
import {
  dismissLateHabits,
  useDismissedLateHabits,
} from "@/lib/stores/late-habit-dismissals";
import { lateHabitKey, type LateHabit } from "@/lib/types/late-habits";

/** Habits shown before the rest fold behind "Show N more". */
const FOLDED_ROWS = 4;

/**
 * A card at the end of a chat, seen only by you, listing what the people in
 * it could use a word about: a habit whose window closed with nothing logged
 * yet (remind them), or a day that went by without it (encourage them). The
 * words are yours, in the composer below: no message written in advance fits
 * every habit.
 *
 * It goes once you've written in the chat since (`get_chat_late_habits`,
 * migration 053), or when dismissed. Dismissing is shared with the inbox,
 * which lists the same ones.
 */

interface EncouragementPromptProps {
  /** As get_chat_late_habits orders them: person by person, reminders first. */
  habits: LateHabit[];
  /**
   * In a group, the habits come under each person's face and name; a friend's
   * chat is theirs alone, so each habit leads.
   */
  showOwners?: boolean;
  /**
   * When you last wrote in this chat, as the thread shows it, a message still
   * sending included. Whatever had closed by then is answered, and goes at
   * once rather than on the next load.
   */
  lastSentAt: number | null;
  className?: string;
}

export function EncouragementPrompt({
  habits,
  showOwners = false,
  lastSentAt,
  className,
}: EncouragementPromptProps) {
  // Null until mounted: drawn only once dismissals are known.
  const dismissed = useDismissedLateHabits();
  // One moment for every row's "today" and "yesterday".
  const [now] = useState(() => new Date());
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const visible = useMemo(() => {
    if (dismissed === null) return [];
    return habits.filter(
      (habit) =>
        !dismissed.has(lateHabitKey(habit)) &&
        (lastSentAt === null || Date.parse(habit.closedAt) > lastSentAt),
    );
  }, [habits, dismissed, lastSentAt]);

  if (visible.length === 0) return null;

  const foldable = visible.length > FOLDED_ROWS;
  const shown = foldable && !expanded ? visible.slice(0, FOLDED_ROWS) : visible;

  return (
    <section
      aria-label="Only you can see this"
      className={cn(
        "late-card-enter rounded-lg border border-border bg-elevated shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 pl-4 pr-1">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary">
          <HandHeart className="h-3.5 w-3.5 shrink-0 text-encourage" aria-hidden />
          Only you can see this
        </p>
        <button
          type="button"
          onClick={() => dismissLateHabits(visible.map(lateHabitKey))}
          aria-label="Dismiss"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            "text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink",
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul
        id={listId}
        className={cn(
          "px-4",
          showOwners ? "space-y-4" : "space-y-3",
          foldable ? "pb-1" : "pb-4",
        )}
      >
        {showOwners
          ? byPerson(shown).map((person) => (
              <li key={person[0].ownerId}>
                <PersonLateHabits habits={person} now={now} />
              </li>
            ))
          : shown.map((habit) => (
              <li key={lateHabitKey(habit)}>
                <LateHabitRow habit={habit} now={now} />
              </li>
            ))}
      </ul>

      {foldable && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={listId}
          className={cn(
            "mx-2 mb-1.5 min-h-11 rounded-md px-2 text-sm font-medium text-brand-ink",
            "transition-colors hover:bg-surface-hover",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink",
          )}
        >
          {expanded ? "Show fewer" : `Show ${visible.length - FOLDED_ROWS} more`}
        </button>
      )}
    </section>
  );
}
