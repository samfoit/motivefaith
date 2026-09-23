"use client";

import { useState } from "react";
import { Calendar, Check, Users } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
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
}

/** What the challenge runs between, written the short way. */
function dateRange(challenge: GroupChallenge): string {
  const start = format(new Date(challenge.start_date), "MMM d");
  return challenge.end_date
    ? `${start} – ${format(new Date(challenge.end_date), "MMM d")}`
    : `From ${start}`;
}

/**
 * Group challenges as one scrollable line of chips, matching the shared
 * habits directly above them.
 *
 * Each challenge used to be a full-width card carrying its description, dates,
 * participant count and a Join button — four of them filled the screen before
 * a single message was visible. The chip says which challenge it is and
 * whether you are in it; the rest, including joining and leaving, lives one
 * tap away in the sheet.
 */
export function GroupChallenges({
  challenges,
  onJoin,
  onLeave,
  pendingId,
}: GroupChallengesProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = challenges.find((c) => c.id === openId) ?? null;

  if (challenges.length === 0) return null;

  return (
    <>
      {/* Bleeds into the page gutter so the row can scroll edge to edge */}
      <div className="-mx-4 px-4 overflow-x-auto">
        <div className="flex items-center gap-2 w-max">
          {challenges.map((challenge) => {
            const joined = !!challenge.myParticipation;
            return (
              <button
                key={challenge.id}
                type="button"
                onClick={() => setOpenId(challenge.id)}
                aria-label={`${challenge.title} — ${
                  joined ? "you have joined" : "not joined"
                }, ${challenge.participants.length} taking part`}
                className={cn(
                  "habit-tint shrink-0 flex items-center gap-1.5 rounded-full border",
                  "pl-2.5 pr-3 py-1.5 transition-transform active:scale-95",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                )}
                style={{ ["--habit-color" as string]: challenge.color ?? undefined }}
              >
                <span className="text-sm leading-none">{challenge.emoji ?? "🎯"}</span>
                <span className="text-xs font-medium text-text-primary truncate max-w-32">
                  {challenge.title}
                </span>
                {joined ? (
                  <Check className="w-3.5 h-3.5 shrink-0 text-success" />
                ) : (
                  <span className="text-xs text-text-tertiary shrink-0 flex items-center gap-0.5">
                    <Users className="w-3 h-3" />
                    {challenge.participants.length}
                  </span>
                )}
              </button>
            );
          })}
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
              <span>{selected.emoji ?? "🎯"}</span>
              <span className="truncate">{selected.title}</span>
            </span>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill size="sm" variant={selected.myParticipation ? "health" : "default"}>
                {selected.myParticipation ? "Joined" : "Not joined"}
              </Pill>
              <Pill size="sm" variant="default">
                <Calendar className="w-3 h-3 mr-1" />
                {dateRange(selected)}
              </Pill>
            </div>

            {selected.description && (
              <p className="text-sm text-text-secondary">{selected.description}</p>
            )}

            <div>
              <p className="text-xs text-text-tertiary mb-2">
                {selected.participants.length} taking part
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
              <Button
                variant="ghost"
                className="w-full"
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
