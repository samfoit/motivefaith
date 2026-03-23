"use client";

import { motion } from "motion/react";
import { Calendar, Users, Check } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import type { GroupChallenge, GroupChallengeParticipant } from "@/lib/types/groups";
import type { FeedProfile } from "@/lib/types/feed";

interface GroupChallengeCardProps {
  challenge: GroupChallenge & {
    participants: (GroupChallengeParticipant & { profile: FeedProfile })[];
    myParticipation: GroupChallengeParticipant | null;
  };
  onJoin: (challengeId: string) => void;
  onLeave: (challengeId: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function GroupChallengeCard({
  challenge,
  onJoin,
  onLeave,
  isLoading,
  className,
}: GroupChallengeCardProps) {
  const isJoined = !!challenge.myParticipation;
  const participantCount = challenge.participants.length;

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className={cn(
        "rounded-lg bg-elevated p-4 shadow-sm border-l-[3px]",
        className,
      )}
      style={{ borderLeftColor: challenge.color ?? undefined }}
    >
      <div className="flex items-start gap-3">
        {/* Emoji */}
        <span className="text-2xl leading-none mt-0.5">{challenge.emoji}</span>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
            {challenge.title}
          </h3>

          {/* Description */}
          {challenge.description && (
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">
              {challenge.description}
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
              <Calendar className="w-3 h-3" />
              <span>
                {format(new Date(challenge.start_date), "MMM d")}
                {challenge.end_date && ` – ${format(new Date(challenge.end_date), "MMM d")}`}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
              <Users className="w-3 h-3" />
              <span>
                {participantCount} joined
              </span>
            </div>
          </div>
        </div>

        {/* Action button */}
        <div className="flex-shrink-0">
          {isJoined ? (
            <Pill variant="default" size="sm">
              <Check className="w-3 h-3 mr-1" />
              Joined
            </Pill>
          ) : (
            <Button
              size="sm"
              onClick={() => onJoin(challenge.id)}
              loading={isLoading}
            >
              Join
            </Button>
          )}
        </div>
      </div>

      {/* Leave button if joined */}
      {isJoined && (
        <button
          type="button"
          onClick={() => onLeave(challenge.id)}
          className="text-xs text-[var(--color-text-tertiary)] hover:text-miss transition-colors mt-2"
        >
          Leave challenge
        </button>
      )}
    </motion.div>
  );
}
