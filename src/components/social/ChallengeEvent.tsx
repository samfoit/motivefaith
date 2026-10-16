"use client";

import { Avatar } from "@/components/ui/Avatar";

interface ChallengeEventProps {
  kind: "started" | "joined";
  /** "You" for your own. */
  actorName: string;
  actorAvatar: string | null;
  isMe: boolean;
  challengeEmoji: string | null;
  challengeTitle: string;
  /** Offered on a "started" line while you haven't joined. */
  onJoin?: () => void;
  joining?: boolean;
}

/**
 * Something that happened to a group's challenges, in the conversation where
 * it happened: "Alice started 🌅 7-Day Early Bird", "Bob joined it". Centered
 * and quiet, like a messaging app's system line, so it reads as an event and
 * not as anyone's message. A new challenge carries its Join right there — the
 * moment you hear about it is the moment you're most likely to say yes.
 */
export function ChallengeEvent({
  kind,
  actorName,
  actorAvatar,
  isMe,
  challengeEmoji,
  challengeTitle,
  onJoin,
  joining = false,
}: ChallengeEventProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-2">
      <div className="flex max-w-[85%] items-center gap-1.5 text-xs text-text-tertiary">
        {!isMe && (
          <Avatar src={actorAvatar} name={actorName} size="xs" className="shrink-0" />
        )}
        <span className="min-w-0 text-center">
          <span className="font-medium text-text-secondary">{actorName}</span>
          {kind === "started" ? " started " : " joined "}
          <span className="font-medium text-text-secondary">
            {challengeEmoji ?? "🎯"} {challengeTitle}
          </span>
        </span>
      </div>
      {onJoin && (
        <button
          type="button"
          onClick={onJoin}
          disabled={joining}
          className="rounded-full border border-brand-ink/30 px-3 py-1 text-xs font-medium text-brand-ink transition-colors hover:bg-brand-light disabled:opacity-50"
        >
          {joining ? "Joining…" : "Join challenge"}
        </button>
      )}
    </div>
  );
}
