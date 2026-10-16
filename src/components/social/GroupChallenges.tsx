"use client";

import { useState } from "react";
import { Calendar, Check, ChevronRight, Plus, Users } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import type { GroupChallenge, GroupChallengeParticipant } from "@/lib/types/groups";
import type { FeedProfile } from "@/lib/types/feed";

export type GroupChallengeWithParticipants = GroupChallenge & {
  participants: (GroupChallengeParticipant & { profile: FeedProfile })[];
  myParticipation: GroupChallengeParticipant | null;
};

interface GroupChallengesProps {
  challenges: GroupChallengeWithParticipants[];
  onJoin: (challengeId: string) => void;
  onLeave: (challengeId: string) => void;
  /** The challenge currently being joined or left, if any. */
  pendingId?: string | null;
  /**
   * Admins only: a chip at the end of the row to start a challenge. With it
   * the row shows even while there are none, as just that chip.
   */
  onCreate?: () => void;
}

/** What the challenge runs between, written the short way. */
function dateRange(challenge: GroupChallenge): string {
  const start = format(new Date(challenge.start_date), "MMM d");
  return challenge.end_date
    ? `${start} – ${format(new Date(challenge.end_date), "MMM d")}`
    : `From ${start}`;
}

/**
 * A group's challenges, as rows in its info sheet.
 *
 * They were a line of chips at the top of the chat, beside the shared habits
 * — but which challenges are running is reference, not today's status, and
 * the strip there now answers only what's done and what's open today. A row
 * says which challenge it is, when, and whether you are in it; the rest,
 * including joining and leaving, is a tap away in its sheet.
 */
export function GroupChallenges({
  challenges,
  onJoin,
  onLeave,
  pendingId,
  onCreate,
}: GroupChallengesProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = challenges.find((c) => c.id === openId) ?? null;

  if (challenges.length === 0 && !onCreate) return null;

  return (
    <>
      <div className="space-y-1.5">
        {challenges.map((challenge) => {
          const joined = !!challenge.myParticipation;
          return (
            <button
              key={challenge.id}
              type="button"
              onClick={() => setOpenId(challenge.id)}
              className={cn(
                "habit-tint flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left",
                "transition-opacity active:opacity-80",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
              )}
              style={{ ["--habit-color" as string]: challenge.color ?? undefined }}
            >
              <span className="shrink-0 text-base leading-none">{challenge.emoji ?? "🎯"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {challenge.title}
                </span>
                <span className="block truncate text-xs text-text-tertiary">
                  {dateRange(challenge)}
                </span>
              </span>
              {joined ? (
                <span className="shrink-0 flex items-center gap-1 text-xs font-medium text-success">
                  <Check className="w-3.5 h-3.5" />
                  You&apos;re in
                </span>
              ) : (
                <span className="shrink-0 flex items-center gap-1 text-xs text-text-tertiary">
                  <Users className="w-3.5 h-3.5" />
                  {challenge.participants.length}
                </span>
              )}
              <ChevronRight className="w-4 h-4 shrink-0 text-text-tertiary" />
            </button>
          );
        })}
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2.5",
              "text-sm font-medium text-text-secondary transition-colors hover:text-text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
            )}
          >
            <Plus className="w-4 h-4" />
            New challenge
          </button>
        )}
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
              <span>{selected.emoji ?? "🎯"}</span>
              <span className="truncate">{selected.title}</span>
            </span>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-5 pb-2">
            {/* Plain lines with icons, not pills: the pills' light-theme
                fills lit up as white and mint blobs on the dark sheet. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5 text-text-secondary">
                <Calendar className="w-4 h-4 shrink-0 text-text-tertiary" />
                {dateRange(selected)}
              </span>
              {selected.myParticipation && (
                <span className="flex items-center gap-1.5 font-medium text-success">
                  <Check className="w-4 h-4 shrink-0" />
                  You&apos;re in
                </span>
              )}
            </div>

            {selected.description && (
              <p className="text-sm text-text-secondary">{selected.description}</p>
            )}

            <div>
              <p className="text-xs text-text-tertiary mb-2">
                {selected.participants.length === 0
                  ? "Nobody has joined yet"
                  : `${selected.participants.length} taking part`}
              </p>
              {selected.participants.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selected.participants.map((participant) => (
                    <span
                      key={participant.id}
                      className="flex items-center gap-1.5 rounded-full bg-bg-secondary pl-1 pr-2.5 py-1"
                    >
                      <Avatar
                        src={participant.profile.avatar_url}
                        name={participant.profile.display_name}
                        size="xs"
                      />
                      <span className="text-xs text-text-primary truncate max-w-28">
                        {participant.profile.display_name}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {selected.myParticipation ? (
              // Leaving is a step back, not the sheet's main action: neutral,
              // not in the brand colour the ghost button used.
              <Button
                variant="ghost"
                className="w-full !text-text-secondary hover:!text-text-primary"
                loading={pendingId === selected.id}
                onClick={() => onLeave(selected.id)}
              >
                Leave challenge
              </Button>
            ) : (
              <Button
                className="w-full"
                loading={pendingId === selected.id}
                onClick={() => onJoin(selected.id)}
              >
                Join challenge
              </Button>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
