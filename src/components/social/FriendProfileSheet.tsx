"use client";

import { useState } from "react";
import { Flame, Globe, UserPlus, Check, X, Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useProfileHabits } from "@/lib/hooks/useProfileHabits";
import {
  useRequestPartner,
  useCancelPartner,
  useRespondToPartner,
} from "@/lib/hooks/usePartnerActions";
import type { ProfileHabit } from "@/lib/types/partners";

export interface SheetFriend {
  id: string;
  display_name: string;
  avatar_url: string | null;
  username: string;
}

interface FriendProfileSheetProps {
  friend: SheetFriend | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after anything is accepted, declined, asked for or withdrawn. */
  onChanged?: () => void;
}

/**
 * Everything you can do about one friend's habits, in one place.
 *
 * This used to be a section rendered inline on the journey page, which put a
 * list of habits you are *not* following above the conversation you opened the
 * page to read. It is behind a tap now — on their row in the friends list, or
 * their name on the journey page — and it earns the space once you ask for it.
 *
 * Deciding an invitation is possible here as well as in the inbox. The two are
 * the same row and the same RPC; the inbox is where they queue up, this is
 * where you go when you are already thinking about that person.
 */
export function FriendProfileSheet({
  friend,
  open,
  onOpenChange,
  onChanged,
}: FriendProfileSheetProps) {
  const { show: showToast, ToastElements } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: habits = [], isLoading } = useProfileHabits(
    friend?.id ?? null,
    open,
  );

  const requestPartner = useRequestPartner();
  const cancelPartner = useCancelPartner();
  const respond = useRespondToPartner();

  const firstName = friend?.display_name.split(" ")[0] ?? "they";

  // Their move, your move, done, and not started — in the order you care.
  const invitations = habits.filter(
    (h) => h.partnerStatus === "pending" && !h.isInitiator,
  );
  const requested = habits.filter(
    (h) => h.partnerStatus === "pending" && h.isInitiator,
  );
  const partnered = habits.filter((h) => h.partnerStatus === "accepted");
  const open_ = habits.filter((h) => h.partnerStatus === null);

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      showToast({ variant: "success", title: ok });
      onChanged?.();
    } catch (err) {
      showToast({
        variant: "error",
        title: err instanceof Error ? err.message : "Something went wrong",
      });
    }
    setBusyId(null);
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={
          friend ? (
            <span className="flex items-center gap-2.5">
              <Avatar
                src={friend.avatar_url}
                name={friend.display_name}
                size="sm"
              />
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-text-primary">
                  {friend.display_name}
                </span>
                <span className="block truncate text-xs font-normal text-text-tertiary">
                  @{friend.username}
                </span>
              </span>
            </span>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : habits.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-tertiary">
            {firstName} has no habits you can see yet.
          </p>
        ) : (
          <div className="space-y-5 pb-2">
            {invitations.length > 0 && (
              <Group label="Invited you" hint="Waiting on you">
                {invitations.map((h) => (
                  <Row key={h.habitId} habit={h}>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <IconButton
                        label={`Decline ${h.title}`}
                        disabled={busyId === h.habitId}
                        onClick={() =>
                          run(
                            h.habitId,
                            () =>
                              respond.mutateAsync({
                                shareId: h.shareId!,
                                accept: false,
                              }),
                            "Declined",
                          )
                        }
                      >
                        <X className="w-4 h-4" />
                      </IconButton>
                      <Button
                        size="sm"
                        loading={busyId === h.habitId}
                        disabled={busyId === h.habitId}
                        onClick={() =>
                          run(
                            h.habitId,
                            () =>
                              respond.mutateAsync({
                                shareId: h.shareId!,
                                accept: true,
                              }),
                            `Now following ${h.title}`,
                          )
                        }
                      >
                        Accept
                      </Button>
                    </div>
                  </Row>
                ))}
              </Group>
            )}

            {partnered.length > 0 && (
              <Group label="Following">
                {partnered.map((h) => (
                  <Row key={h.habitId} habit={h}>
                    {h.streakCurrent !== null && (
                      <span className="shrink-0 flex items-center gap-1 text-xs font-medium text-streak">
                        <Flame className="w-3.5 h-3.5" />
                        {h.streakCurrent}
                      </span>
                    )}
                  </Row>
                ))}
              </Group>
            )}

            {requested.length > 0 && (
              <Group label="Requested" hint={`Waiting on ${firstName}`}>
                {requested.map((h) => (
                  <Row key={h.habitId} habit={h} muted>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="flex items-center gap-1 text-xs text-text-tertiary">
                        <Check className="w-3 h-3" />
                        Sent
                      </span>
                      <IconButton
                        label={`Withdraw request for ${h.title}`}
                        disabled={busyId === h.habitId}
                        onClick={() =>
                          run(
                            h.habitId,
                            () => cancelPartner.mutateAsync(h.shareId!),
                            "Request withdrawn",
                          )
                        }
                      >
                        <X className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  </Row>
                ))}
              </Group>
            )}

            {open_.length > 0 && (
              <Group
                label={`${firstName}'s other habits`}
                hint="Streak shows once accepted"
              >
                {open_.map((h) => (
                  <Row key={h.habitId} habit={h}>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      loading={busyId === h.habitId}
                      disabled={busyId === h.habitId}
                      onClick={() =>
                        run(
                          h.habitId,
                          () => requestPartner.mutateAsync(h.habitId),
                          "Request sent",
                        )
                      }
                    >
                      {/* Button wraps its children in one block-level span, so
                          at this width the icon stacked above the label. An
                          explicit row keeps them side by side. */}
                      <span className="inline-flex items-center gap-1.5">
                        <UserPlus className="w-3.5 h-3.5" />
                        Follow
                      </span>
                    </Button>
                  </Row>
                ))}
              </Group>
            )}
          </div>
        )}
      </Sheet>
      {ToastElements}
    </>
  );
}

// ---------------------------------------------------------------------------

function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-text-secondary">{label}</h3>
        {hint && (
          <span className="min-w-0 text-right text-[11px] text-text-tertiary">
            {hint}
          </span>
        )}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({
  habit,
  muted,
  children,
}: {
  habit: ProfileHabit;
  muted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "habit-tint flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
        muted && "opacity-75",
      )}
      style={{ ["--habit-color" as string]: habit.color }}
    >
      <span className="shrink-0 text-base leading-none">{habit.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {habit.title}
        </span>
      </span>
      {habit.visibility === "private" ? (
        <Lock className="w-3 h-3 shrink-0 text-text-tertiary" aria-label="Private habit" />
      ) : (
        <Globe className="w-3 h-3 shrink-0 text-text-tertiary" aria-label="Public habit" />
      )}
      {children}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-miss disabled:opacity-50"
    >
      {children}
    </button>
  );
}
