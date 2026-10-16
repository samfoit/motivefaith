"use client";

import React, { useRef, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { MessageMedia } from "@/components/social/MessageMedia";

/**
 * The pieces every chat thread is built from — the friend chat and the group
 * chat both, so the two read as one product.
 *
 * Messages from one person in a row are a run: one name, one avatar, bubbles
 * stacked tight. A time sits between runs only when time has passed, not
 * under every bubble. Hearting and reporting are behind a long press, as in
 * any messaging app, instead of a column of icons beside each bubble.
 */

// ---------------------------------------------------------------------------
// Runs and time dividers
// ---------------------------------------------------------------------------

/** A gap this long starts a new run even from the same person. */
const RUN_GAP_MS = 5 * 60 * 1000;
/** A gap this long puts the time between the two. */
const DIVIDER_GAP_MS = 15 * 60 * 1000;

export type RunPosition = {
  /** Starts a run: the name goes above it, more space before it. */
  first: boolean;
  /** Ends a run: the avatar sits beside it. */
  last: boolean;
  /** The time to show above it, when time has passed since the last item. */
  divider: string | null;
};

function dividerLabel(at: number): string {
  const date = new Date(at);
  const time = format(date, "h:mm a");
  if (isToday(date)) return time;
  if (isYesterday(date)) return `Yesterday ${time}`;
  return `${format(date, "EEE")} ${time}`;
}

/**
 * Where each item falls in its run. `sender` is null for something that is
 * nobody's message, such as a challenge event: it is always a run of its own.
 * Items must already be in time order.
 */
export function layoutRuns(
  items: { sender: string | null; at: number }[],
): RunPosition[] {
  const positions: RunPosition[] = items.map((item, i) => {
    const prev = items[i - 1];
    const gap = prev ? item.at - prev.at : Infinity;
    const divider = gap >= DIVIDER_GAP_MS ? dividerLabel(item.at) : null;
    const first =
      !prev ||
      divider !== null ||
      item.sender === null ||
      prev.sender !== item.sender ||
      gap > RUN_GAP_MS;
    return { first, last: true, divider };
  });
  for (let i = 0; i < positions.length - 1; i++) {
    positions[i].last = positions[i + 1].first;
  }
  return positions;
}

export function TimeDivider({ label }: { label: string }) {
  return (
    <p className="pt-5 pb-1 text-center text-[11px] font-medium text-text-tertiary">
      {label}
    </p>
  );
}

/**
 * A bubble's corners: round, except on the sender's side where bubbles in a
 * run meet. The run's last keeps its bottom corner tight too, the way a tail
 * would, so the column of a run reads as one voice.
 */
export function bubbleCorners(isMe: boolean, first: boolean): string {
  return cn(
    "rounded-[20px]",
    isMe ? "rounded-br-md" : "rounded-bl-md",
    !first && (isMe ? "rounded-tr-md" : "rounded-tl-md"),
  );
}

// ---------------------------------------------------------------------------
// A row: alignment, name, avatar, long-press actions, received hearts
// ---------------------------------------------------------------------------

export type ChatAction = {
  label: string;
  icon: React.ElementType;
  onSelect: () => void;
  danger?: boolean;
};

/** Held this long, a press opens the actions. */
const LONG_PRESS_MS = 450;
/** Moving this far is a scroll, not a press. */
const PRESS_SLOP_PX = 10;

function useLongPress(onLongPress: (() => void) | undefined) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  if (!onLongPress) return {};

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return; // right-click is the mouse's way
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        cancel();
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current) return;
      if (
        Math.abs(e.clientX - start.current.x) > PRESS_SLOP_PX ||
        Math.abs(e.clientY - start.current.y) > PRESS_SLOP_PX
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      cancel();
      onLongPress();
    },
  };
}

interface ChatRowProps {
  isMe: boolean;
  position: RunPosition;
  /** Group chats name each run and show whose face it is; a DM needn't. */
  showSender: boolean;
  senderName?: string;
  senderAvatar?: string | null;
  /** Hearts it has, shown on its corner. */
  heartCount?: number;
  /** What a long press offers. Empty: the row doesn't respond to one. */
  actions?: ChatAction[];
  /** Says what was long-pressed, for the actions sheet's title. */
  actionsTitle?: string;
  children: React.ReactNode;
}

export function ChatRow({
  isMe,
  position,
  showSender,
  senderName,
  senderAvatar,
  heartCount = 0,
  actions = [],
  actionsTitle,
  children,
}: ChatRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const press = useLongPress(actions.length > 0 ? () => setMenuOpen(true) : undefined);
  const withSender = showSender && !isMe;

  return (
    <>
      {position.divider && <TimeDivider label={position.divider} />}
      <div
        className={cn(
          "flex items-end gap-2",
          isMe ? "justify-end" : "justify-start",
          position.first ? "mt-3" : "mt-0.5",
          // The bottom of a run makes room for the hearts on its corner.
          heartCount > 0 && "mb-4",
        )}
      >
        {withSender && (
          <div className="w-7 shrink-0">
            {position.last && (
              <Avatar src={senderAvatar ?? null} name={senderName ?? ""} size="xs" className="w-7 h-7" />
            )}
          </div>
        )}
        <div
          className={cn(
            "flex min-w-0 max-w-[78%] flex-col",
            isMe ? "items-end" : "items-start",
          )}
        >
          {withSender && position.first && senderName && (
            <p className="mb-1 px-3 text-xs font-medium text-text-tertiary">{senderName}</p>
          )}
          <div
            className={cn("relative max-w-full", actions.length > 0 && "motive-press-hold")}
            {...press}
          >
            {children}
            {heartCount > 0 && (
              <span
                className={cn(
                  "absolute -bottom-2.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5",
                  "bg-bg-elevated text-[11px] font-medium text-miss shadow-sm ring-1 ring-border",
                  isMe ? "left-2" : "right-2",
                )}
                aria-label={`${heartCount} ${heartCount === 1 ? "heart" : "hearts"}`}
              >
                <Heart className="w-3 h-3" fill="currentColor" />
                {heartCount > 1 && heartCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {actions.length > 0 && (
        <Sheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          size="sm"
          title={actionsTitle}
        >
          <div className="mb-4 overflow-hidden rounded-lg bg-bg-secondary divide-y divide-border">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  action.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors hover:bg-surface-hover",
                  action.danger ? "text-miss" : "text-text-primary",
                )}
              >
                <action.icon className={cn("w-5 h-5 shrink-0", !action.danger && "text-text-secondary")} />
                {action.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// A message: text, photo, video, voice
// ---------------------------------------------------------------------------

/** One to three emoji and nothing else: sent big, without a bubble. */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*){1,3}$/u;

interface MessageBubbleProps {
  isMe: boolean;
  first: boolean;
  content: string | null;
  mediaPath?: string | null;
  mediaType?: "photo" | "video" | "voice" | null;
}

/**
 * A message, whatever it carries. Text is a bubble. A photo or video is the
 * picture itself, shaped like a bubble, with no frame around it — and a
 * caption under it in a bubble of its own. A voice note is a bubble holding
 * the player. A few emoji alone are sent big, with no bubble at all.
 */
export function MessageBubble({
  isMe,
  first,
  content,
  mediaPath,
  mediaType,
}: MessageBubbleProps) {
  const text = content?.trim() || null;
  const corners = bubbleCorners(isMe, first);
  const surface = cn("chat-bubble", isMe && "chat-bubble--mine");

  if (mediaPath && (mediaType === "photo" || mediaType === "video")) {
    return (
      <div className={cn("flex flex-col gap-0.5", isMe ? "items-end" : "items-start")}>
        <MessageMedia path={mediaPath} type={mediaType} className={cn(corners, "overflow-hidden")} />
        {text && (
          <p className={cn(surface, bubbleCorners(isMe, false), "px-3.5 py-2 text-[15px] leading-snug text-text-primary break-words")}>
            {text}
          </p>
        )}
      </div>
    );
  }

  if (mediaPath && mediaType === "voice") {
    return (
      <div className={cn(surface, corners, "px-2.5 py-2")}>
        <MessageMedia path={mediaPath} type="voice" />
        {text && (
          <p className="mt-1.5 px-1 text-[15px] leading-snug text-text-primary break-words">{text}</p>
        )}
      </div>
    );
  }

  if (text && EMOJI_ONLY.test(text)) {
    return <p className="px-1 text-4xl leading-tight">{text}</p>;
  }

  return (
    <p
      className={cn(
        surface,
        corners,
        "px-3.5 py-2 text-[15px] leading-snug text-text-primary break-words whitespace-pre-line",
      )}
    >
      {text}
    </p>
  );
}
