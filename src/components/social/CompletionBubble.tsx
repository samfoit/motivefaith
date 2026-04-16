"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Camera, Video, MessageSquare, Zap, Play, X, Heart, MoreHorizontal, Mic } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { EvidenceMedia } from "@/components/ui/EvidenceMedia";
import { EvidenceAudio } from "@/components/ui/EvidenceAudio";
import { Avatar } from "@/components/ui/Avatar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompletionBubbleProps {
  isMe: boolean;
  habitEmoji: string;
  habitTitle: string;
  habitColor: string;
  completionType: "photo" | "video" | "message" | "quick" | "voice";
  evidenceUrl: string | null;
  notes: string | null;
  completedAt: string;
  /** Number of hearts received (displayed on own completions) */
  heartCount: number;
  /** Whether the current user has hearted this */
  isHearted: boolean;
  /** Called when user taps heart. Omit to hide heart button. */
  onHeart?: () => void;
  /** Called when user taps report (three-dot). Omit to hide report button. */
  onReport?: () => void;
  /** Sender display name — shown above content for others in group context */
  senderName?: string;
  /** Sender avatar URL — shown beside bubble for others in group context */
  senderAvatar?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, React.ElementType> = {
  quick: Zap,
  photo: Camera,
  video: Video,
  message: MessageSquare,
  voice: Mic,
};

export function slideVariant(isMe: boolean) {
  return {
    hidden: { opacity: 0, x: isMe ? 20 : -20 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CompletionBubble = React.memo(function CompletionBubble({
  isMe,
  habitEmoji,
  habitTitle,
  habitColor,
  completionType,
  evidenceUrl,
  notes,
  completedAt,
  heartCount,
  isHearted,
  onHeart,
  onReport,
  senderName,
  senderAvatar,
}: CompletionBubbleProps) {
  const Icon = TYPE_ICONS[completionType] ?? Zap;
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <>
      <motion.div
        variants={slideVariant(isMe)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        className={cn("flex", isMe ? "justify-end" : "justify-start")}
      >
        <div
          className={cn(
            "max-w-[80%] flex items-end gap-1.5",
            isMe && "flex-row-reverse",
          )}
        >
          {/* Avatar (group context — when senderName is provided) */}
          {!isMe && senderName && (
            <Avatar
              src={senderAvatar ?? null}
              name={senderName}
              size="sm"
              className="flex-shrink-0 mb-1"
            />
          )}

          <div
            className={cn(
              "min-w-0 rounded-xl px-3.5 py-2.5 space-y-1.5 overflow-hidden",
              isMe
                ? "bg-brand-light rounded-br-sm"
                : "bg-[var(--color-bg-secondary)] rounded-bl-sm",
            )}
          >
            {/* Sender name (group context) */}
            {!isMe && senderName && (
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
                {senderName}
              </p>
            )}

            {/* Habit + type */}
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{habitEmoji}</span>
              <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                {habitTitle}
              </span>
              <Icon
                className="w-3 h-3 flex-shrink-0"
                style={{ color: habitColor }}
              />
            </div>

            {/* Photo evidence */}
            {completionType === "photo" && evidenceUrl && (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="block -mx-3.5 cursor-zoom-in"
              >
                <EvidenceMedia
                  path={evidenceUrl}
                  type="photo"
                  alt="Completion photo"
                  className="w-full h-44 object-cover bg-[var(--color-bg-secondary)]"
                />
              </button>
            )}

            {/* Video evidence */}
            {completionType === "video" && evidenceUrl && (
              <div className="-mx-3.5 relative bg-[var(--color-bg-secondary)] select-none" style={{ WebkitTouchCallout: "none" }}>
                <EvidenceMedia
                  path={evidenceUrl}
                  type="video"
                  className="w-full max-h-56"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center">
                    <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
                  </div>
                </div>
              </div>
            )}

            {/* Voice evidence */}
            {completionType === "voice" && evidenceUrl && (
              <div className="-mx-3.5 px-3.5 py-1">
                <EvidenceAudio path={evidenceUrl} />
              </div>
            )}

            {/* Notes */}
            {notes && (
              <p className="text-xs text-[var(--color-text-secondary)] italic">
                &ldquo;{notes}&rdquo;
              </p>
            )}

            {/* Time + received hearts */}
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] text-[var(--color-text-tertiary)]">
                {format(new Date(completedAt), "h:mm a")}
              </p>
              {isMe && heartCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-red-500">
                  <Heart className="w-3 h-3" fill="currentColor" />
                  {heartCount > 1 && (
                    <span className="text-[10px] font-medium">{heartCount}</span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Actions — only on others' completions */}
          {!isMe && (onReport || onHeart) && (
            <div className="flex flex-col items-center gap-0.5 mb-1 flex-shrink-0">
              {onReport && (
                <button
                  type="button"
                  onClick={onReport}
                  className="p-1 rounded-full text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  aria-label="More options"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
              {onHeart && (
                <button
                  type="button"
                  onClick={onHeart}
                  className={cn(
                    "p-1.5 rounded-full transition-all",
                    isHearted
                      ? "text-red-500"
                      : "text-[var(--color-text-tertiary)] hover:text-red-400 active:scale-90",
                  )}
                  aria-label={isHearted ? "Remove heart" : "Heart this completion"}
                >
                  <Heart className="w-4 h-4" fill={isHearted ? "currentColor" : "none"} />
                </button>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Photo lightbox */}
      {completionType === "photo" && evidenceUrl && (
        <AnimatePresence>
          {lightboxOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
              onClick={() => setLightboxOpen(false)}
            >
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] as const }}
                className="relative w-[90vw] h-[80vh] flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                <EvidenceMedia
                  path={evidenceUrl}
                  type="photo"
                  alt="Completion photo"
                  className="max-w-full max-h-full object-contain"
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
});
