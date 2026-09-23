"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe, HandHeart, Check, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useRequestPartner, useCancelPartner } from "@/lib/hooks/usePartnerActions";
import type { ProfileHabit } from "@/lib/types/partners";

interface DiscoverableHabitsProps {
  habits: ProfileHabit[];
  friendName: string;
  onChanged?: () => void;
}

/**
 * A friend's public habits that you are not already partnered on.
 *
 * This is the whole point of `public`: it gives a friend something to ask
 * about. The card says what the habit is and nothing about how it is going —
 * the streak lives behind the partnership, and the server enforces that, so
 * there is no number to render here even if we wanted one.
 *
 * Habits you already watch are not repeated here; they are chips in
 * `SharedHabits` above, with their stats.
 */
export function DiscoverableHabits({
  habits,
  friendName,
  onChanged,
}: DiscoverableHabitsProps) {
  const { show: showToast, ToastElements } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const requestPartner = useRequestPartner();
  const cancelPartner = useCancelPartner();

  if (habits.length === 0) return null;

  const handleAsk = async (habit: ProfileHabit) => {
    setBusyId(habit.habitId);
    try {
      await requestPartner.mutateAsync(habit.habitId);
      showToast({
        variant: "success",
        title: "Request sent",
        description: `${friendName} can accept or decline.`,
      });
      onChanged?.();
    } catch (err) {
      // The decline cooldown comes back here, and saying so is kinder than a
      // generic failure that invites another tap.
      showToast({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to send request",
      });
    }
    setBusyId(null);
  };

  const handleWithdraw = async (habit: ProfileHabit) => {
    if (!habit.shareId) return;
    setBusyId(habit.habitId);
    try {
      await cancelPartner.mutateAsync(habit.shareId);
      showToast({ variant: "info", title: "Request withdrawn" });
      onChanged?.();
    } catch {
      showToast({ variant: "error", title: "Failed to withdraw request" });
    }
    setBusyId(null);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Globe className="w-3.5 h-3.5 text-text-tertiary" />
        <h2 className="text-sm font-medium text-text-secondary">
          {friendName}&apos;s other habits
        </h2>
      </div>

      <div className="space-y-1.5">
        {habits.map((habit) => {
          const isBusy = busyId === habit.habitId;
          // Pending, and they started it: this is an invitation sitting in the
          // inbox. Answering it here would duplicate that surface, so it points
          // at it instead.
          const theyInvitedMe =
            habit.partnerStatus === "pending" && !habit.isInitiator;
          const iAsked = habit.partnerStatus === "pending" && habit.isInitiator;

          return (
            <div
              key={habit.habitId}
              className={cn(
                "habit-tint flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
              )}
              style={{ ["--habit-color" as string]: habit.color }}
            >
              <span className="text-base leading-none shrink-0">
                {habit.emoji}
              </span>
              <p className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">
                {habit.title}
              </p>

              {theyInvitedMe ? (
                <Link
                  href="/main/inbox"
                  className="shrink-0 text-xs font-medium text-brand hover:underline"
                >
                  Invited you
                </Link>
              ) : iAsked ? (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-text-tertiary flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Requested
                  </span>
                  <button
                    type="button"
                    onClick={() => handleWithdraw(habit)}
                    disabled={isBusy}
                    className="p-1 rounded-md hover:bg-surface-hover text-text-tertiary hover:text-miss transition-colors disabled:opacity-50"
                    aria-label={`Withdraw request for ${habit.title}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  loading={isBusy}
                  disabled={isBusy}
                  onClick={() => handleAsk(habit)}
                >
                  <HandHeart className="w-3.5 h-3.5" />
                  <span>Ask to partner</span>
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-text-tertiary">
        You&apos;ll see their streak once they accept.
      </p>

      {ToastElements}
    </section>
  );
}
