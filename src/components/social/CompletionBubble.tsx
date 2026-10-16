"use client";

import React, { useState } from "react";
import { Check, CloudRain, Heart } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EvidenceMedia } from "@/components/ui/EvidenceMedia";
import { EvidenceAudio } from "@/components/ui/EvidenceAudio";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { isRainCheck, type CompletionType } from "@/lib/constants/completion";
import { rainCheckReasonLabel } from "@/lib/constants/rain-check";
import { weekdayName } from "@/lib/utils/timezone";
import { bubbleCorners } from "@/components/social/ChatParts";

export interface CompletionBubbleProps {
  isMe: boolean;
  /** Starts its run: the corner on the sender's side stays round. */
  first: boolean;
  habitEmoji: string;
  habitTitle: string;
  habitColor: string;
  completionType: CompletionType;
  /** Set only on a rain check — why they skipped. */
  rainCheckReason?: string | null;
  /** Set when the rain check was moved rather than skipped; a date key. */
  rainCheckMovedTo?: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  /** Whether you've hearted it. */
  isHearted?: boolean;
  /** Someone else's check-in: cheer it with a heart. Omit on your own. */
  onHeart?: () => void;
}

/**
 * A check-in, in the conversation. Not a speech bubble — it's news about a
 * habit, so it wears that habit's tint and border, the same as the habit's
 * chip at the top of the chat. Its photo or video is the top of the card,
 * edge to edge; the habit and what happened sit under it; a note reads as
 * plain text, not a quotation.
 *
 * A rain check is a deliberate skip, not an achievement: it never borrows
 * the habit's color, and a dashed rain-blue edge says "not today, on
 * purpose" without reading as a failure.
 *
 * Someone else's check-in carries its heart right on the card, because
 * cheering a check-in is what this app is for; a message's heart is behind a
 * long press instead.
 */
export const CompletionBubble = React.memo(function CompletionBubble({
  isMe,
  first,
  habitEmoji,
  habitTitle,
  habitColor,
  completionType,
  rainCheckReason,
  rainCheckMovedTo,
  evidenceUrl,
  notes,
  isHearted = false,
  onHeart,
}: CompletionBubbleProps) {
  const rainCheck = isRainCheck(completionType);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const note = notes?.trim() || null;
  const hasMedia = (completionType === "photo" || completionType === "video") && !!evidenceUrl;

  return (
    <>
      <div
        className={cn(
          "max-w-full overflow-hidden border",
          // A picture sets a width to fill; without one, it hugs its words.
          hasMedia ? "w-64" : "w-fit min-w-52",
          bubbleCorners(isMe, first),
          rainCheck ? "chat-bubble border-dashed" : "habit-tint",
        )}
        style={
          rainCheck
            ? { borderColor: "color-mix(in oklab, var(--color-rain) 55%, transparent)" }
            : {
                ["--habit-color" as string]: habitColor,
                // Half strength: at full, a red or green habit's edge was the
                // loudest thing on the screen, louder than the words in it.
                borderColor: "color-mix(in oklab, var(--habit-color) 45%, var(--color-bg-elevated))",
              }
        }
      >
        {completionType === "photo" && evidenceUrl && (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block w-full cursor-zoom-in"
            aria-label={`View ${habitTitle} photo`}
          >
            <EvidenceMedia
              path={evidenceUrl}
              type="photo"
              alt={`${habitTitle} check-in`}
              className="w-full bg-bg-secondary"
            />
          </button>
        )}

        {completionType === "video" && evidenceUrl && (
          <EvidenceMedia
            path={evidenceUrl}
            type="video"
            className="block w-full bg-black"
            // Filled like a photo: a portrait clip in a fixed frame otherwise
            // sat between two black bars. Full screen shows all of it.
            videoClassName="max-h-80 object-cover"
          />
        )}

        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none"
            style={{
              backgroundColor: rainCheck
                ? "color-mix(in oklab, var(--color-rain) 14%, transparent)"
                : "color-mix(in oklab, var(--habit-color) 18%, transparent)",
            }}
            aria-hidden
          >
            {habitEmoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary">{habitTitle}</p>
            {rainCheck ? (
              <p className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--color-rain)" }}>
                <CloudRain className="h-3.5 w-3.5 shrink-0" />
                {rainCheckMovedTo ? `Moved to ${weekdayName(rainCheckMovedTo)}` : "Rain check"}
              </p>
            ) : (
              <p className="flex items-center gap-1 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                Checked in
              </p>
            )}
          </div>
          {onHeart && (
            <button
              type="button"
              onClick={onHeart}
              className={cn(
                "-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90",
                isHearted ? "text-miss" : "text-text-tertiary hover:text-miss",
              )}
              aria-label={isHearted ? "Remove heart" : `Heart ${habitTitle}`}
              aria-pressed={isHearted}
            >
              <Heart className="h-[18px] w-[18px]" fill={isHearted ? "currentColor" : "none"} />
            </button>
          )}
        </div>

        {completionType === "voice" && evidenceUrl && (
          <div className="px-3 pb-3">
            <EvidenceAudio path={evidenceUrl} />
          </div>
        )}

        {(rainCheck || note) && (
          <div className="-mt-0.5 space-y-0.5 px-3 pb-3">
            {rainCheck && (
              <p className="text-sm text-text-secondary">{rainCheckReasonLabel(rainCheckReason)}</p>
            )}
            {note && (
              <p className="whitespace-pre-line break-words text-sm leading-snug text-text-primary">
                {note}
              </p>
            )}
          </div>
        )}
      </div>

      {completionType === "photo" && evidenceUrl && (
        <MediaLightbox
          path={evidenceUrl}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          alt={`${habitTitle} check-in`}
        />
      )}
    </>
  );
});
