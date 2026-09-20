"use client";

import React, { useRef, useCallback, useEffect, useId } from "react";
import { Check, ChevronRight, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { CHECK_IN_OPTIONS, type CheckInAction } from "@/lib/constants/check-in";
import { useHabitDrawerStore } from "@/lib/stores/habit-drawer-store";
import type { Tables } from "@/lib/supabase/types";

// --- Drawer geometry -------------------------------------------------------
// The card slides right by exactly the width of the option row, so the icons
// end up in the space the card vacated.
const OPTION_SIZE = 40;
const OPTION_GAP = 8;
const DRAWER_PADDING = 12;
const REVEAL_PX =
  DRAWER_PADDING * 2 +
  CHECK_IN_OPTIONS.length * OPTION_SIZE +
  (CHECK_IN_OPTIONS.length - 1) * OPTION_GAP;
/** Strip of card kept on screen on narrow phones, so it stays grabbable. */
const MIN_CARD_VISIBLE = 64;
/** Pointer travel before a gesture commits to horizontal (vs. page scroll). */
const DIRECTION_LOCK_PX = 8;
/** Fraction of the reveal a drag must cover to settle open. */
const OPEN_RATIO = 0.4;

/**
 * Resolved by the browser against the card's own width, so no measurement is
 * needed for the resting state — only the live drag clamps in pixels.
 */
const OPEN_TRANSFORM = `translate3d(min(${REVEAL_PX}px, calc(100% - ${MIN_CARD_VISIBLE}px)), 0, 0)`;

type CompletionSlice = {
  id: string;
  completed_at: string;
  completion_type: Tables<"completions">["completion_type"];
};

export type HabitWithCompletions = Tables<"habits"> & {
  completions: CompletionSlice[];
  challenge?: { title: string; emoji: string } | null;
};

interface HabitCardProps {
  habit: HabitWithCompletions;
  completedToday: boolean;
  onQuickComplete: (habitId: string, origin?: { x: number; y: number }) => void;
  onPress?: (habitId: string) => void;
  /** Fired when a check-in icon is picked from the drawer. */
  onCheckIn?: (
    habitId: string,
    action: CheckInAction,
    origin?: { x: number; y: number },
  ) => void;
  className?: string;
}

export const HabitCard = React.memo(function HabitCard({
  habit,
  completedToday,
  onQuickComplete,
  onPress,
  onCheckIn,
  className,
}: HabitCardProps) {
  const latestCompletion = habit.completions.length
    ? habit.completions.reduce((latest, c) =>
      new Date(c.completed_at) > new Date(latest.completed_at) ? c : latest,
    )
    : null;

  const lastCompletionLabel = latestCompletion
    ? formatDistanceToNow(new Date(latestCompletion.completed_at), {
      addSuffix: true,
    })
    : null;

  const timeWindow = habit.time_window as { start?: string; end?: string } | null;
  const scheduledTime = timeWindow?.start
    ? (() => {
      const [h, m] = timeWindow.start!.split(":").map(Number);
      const suffix = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
    })()
    : null;

  const handleCircleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completedToday) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onQuickComplete(habit.id, {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  // --- Check-in drawer -----------------------------------------------------

  const drawerId = useId();
  const isOpen = useHabitDrawerStore((s) => s.openHabitId === habit.id);
  const openDrawer = useHabitDrawerStore((s) => s.open);
  const closeDrawer = useHabitDrawerStore((s) => s.close);
  // Nothing left to check in once the habit is done for the day.
  const drawerEnabled = !completedToday && !!onCheckIn;

  const trackRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const toggleDrawer = useCallback(() => {
    if (isOpen) closeDrawer(habit.id);
    else openDrawer(habit.id);
  }, [isOpen, habit.id, openDrawer, closeDrawer]);

  // The transform lives on the DOM node rather than in the style prop: a drag
  // writes it every pointermove, and routing that through React would re-render
  // the card on every frame of the gesture.
  const dragRef = useRef({
    active: false,
    locked: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    base: 0,
    reveal: 0,
  });
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node || dragRef.current.locked) return;
    node.style.transition = "";
    // A card completed while its drawer was open slides back on its own.
    node.style.transform = isOpen && drawerEnabled ? OPEN_TRANSFORM : "";
  }, [isOpen, drawerEnabled]);

  // An open drawer is a transient mode: Escape or a tap anywhere else ends it.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer(habit.id);
    };
    const onPointerDownOutside = (e: PointerEvent) => {
      if (!trackRef.current?.contains(e.target as Node)) closeDrawer(habit.id);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDownOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDownOutside);
    };
  }, [isOpen, habit.id, closeDrawer]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!drawerEnabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const track = trackRef.current;
      if (!track) return;
      // Cleared here rather than only in the click handler: a gesture that
      // ends in a pointercancel never produces a click to clear it, and a
      // stale flag would swallow the next genuine tap.
      suppressClickRef.current = false;
      const reveal = Math.max(
        0,
        Math.min(REVEAL_PX, track.clientWidth - MIN_CARD_VISIBLE),
      );
      dragRef.current = {
        active: true,
        locked: false,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        base: isOpen ? reveal : 0,
        reveal,
      };
    },
    [drawerEnabled, isOpen],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.locked) {
      // Vertical first means the user is scrolling the list — let go of it.
      if (Math.abs(dy) > DIRECTION_LOCK_PX && Math.abs(dy) >= Math.abs(dx)) {
        drag.active = false;
        return;
      }
      if (Math.abs(dx) < DIRECTION_LOCK_PX) return;
      drag.locked = true;
      suppressClickRef.current = true;
      surfaceRef.current?.setPointerCapture(e.pointerId);
      if (surfaceRef.current) surfaceRef.current.style.transition = "none";
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(10);
      }
    }

    const offset = Math.min(drag.reveal, Math.max(0, drag.base + dx));
    if (surfaceRef.current) {
      surfaceRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      drag.active = false;
      if (!drag.locked) return; // A tap — the click handler decides what it meant.
      drag.locked = false;

      const offset = Math.min(
        drag.reveal,
        Math.max(0, drag.base + (e.clientX - drag.startX)),
      );
      // Opening asks for a deliberate pull; closing only needs a nudge back.
      const shouldOpen =
        drag.base > 0
          ? offset > drag.reveal * (1 - OPEN_RATIO)
          : offset > drag.reveal * OPEN_RATIO;

      const node = surfaceRef.current;
      if (node) {
        node.style.transition = ""; // Hand the settle back to the CSS transition.
        node.style.transform = shouldOpen ? OPEN_TRANSFORM : "";
      }
      if (shouldOpen) openDrawer(habit.id);
      else closeDrawer(habit.id);
    },
    [habit.id, openDrawer, closeDrawer],
  );

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (isOpen) {
      closeDrawer(habit.id);
      return;
    }
    onPress?.(habit.id);
  }, [isOpen, habit.id, closeDrawer, onPress]);

  const handleCheckIn = useCallback(
    (action: CheckInAction, e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      closeDrawer(habit.id);
      onCheckIn?.(habit.id, action, {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    },
    [habit.id, closeDrawer, onCheckIn],
  );

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative overflow-hidden rounded-lg bg-bg-secondary",
        className,
      )}
    >
      {/* Check-in drawer, revealed as the card slides off it */}
      {drawerEnabled && (
        <div
          id={drawerId}
          inert={!isOpen}
          className="absolute inset-y-0 left-0 flex items-center"
          style={{ gap: OPTION_GAP, paddingInline: DRAWER_PADDING }}
        >
          {CHECK_IN_OPTIONS.map((option, i) => (
            <button
              key={option.action}
              type="button"
              onClick={(e) => handleCheckIn(option.action, e)}
              aria-label={`${option.label} for ${habit.title}`}
              className={cn(
                "hc-option shrink-0 rounded-full text-white shadow-sm",
                "flex items-center justify-center",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand",
              )}
              style={{
                width: OPTION_SIZE,
                height: OPTION_SIZE,
                backgroundColor: option.color,
                // Icons land one after another as the card clears them. The
                // scale goes through a custom property so the press state can
                // still override it from the stylesheet.
                opacity: isOpen ? 1 : 0,
                ["--hc-option-scale" as string]: isOpen ? "1" : "0.6",
                transitionDelay: isOpen ? `${60 + i * 40}ms` : "0ms",
              } as React.CSSProperties}
            >
              <option.icon className="w-[18px] h-[18px]" strokeWidth={2.25} />
            </button>
          ))}
        </div>
      )}

      {/* Card surface */}
      <div
        ref={surfaceRef}
        className={cn(
          // An explicit background is load-bearing here: the drawer sits
          // directly behind the card and must not show through it.
          "hc-surface relative flex items-center gap-2 rounded-lg py-4 pl-2 pr-4 shadow-sm",
          "border-l-[3px] cursor-pointer select-none",
          "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "active:brightness-[0.98]",
        )}
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          borderLeftColor: habit.color ?? undefined,
          touchAction: "pan-y",
          WebkitTouchCallout: "none",
          WebkitTapHighlightColor: "transparent",
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={handleClick}
      >
        {/* Drawer handle */}
        {drawerEnabled ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleDrawer();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-expanded={isOpen}
            aria-controls={drawerId}
            aria-label={
              isOpen
                ? `Hide check-in options for ${habit.title}`
                : `Show check-in options for ${habit.title}`
            }
            className={cn(
              "shrink-0 -my-1 w-7 h-11 flex items-center justify-center rounded-md",
              "text-text-tertiary hover:text-text-secondary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            )}
          >
            <ChevronRight
              className={cn(
                "w-4 h-4 transition-transform duration-300",
                isOpen && "rotate-180",
              )}
            />
          </button>
        ) : (
          <div className="shrink-0 w-7" aria-hidden />
        )}

        {/* Emoji + Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">{habit.emoji}</span>
            <h3
              className={cn(
                "font-medium truncate",
                completedToday
                  ? "text-text-secondary"
                  : "text-text-primary",
              )}
              style={{ fontSize: "var(--text-lg)" }}
            >
              {habit.title}
            </h3>
          </div>

          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {scheduledTime && (
              <span className="text-xs text-text-tertiary flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {scheduledTime}
              </span>
            )}
            {habit.challenge && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-light text-brand">
                {habit.challenge.emoji} {habit.challenge.title}
              </span>
            )}
            {(habit.streak_current ?? 0) > 0 && (
              <span className="text-xs font-mono text-streak flex items-center gap-0.5">
                {habit.streak_current}-{habit.frequency === "weekly" ? "week" : "day"} streak
              </span>
            )}
            {lastCompletionLabel && (
              <span className="text-xs text-text-tertiary">
                {lastCompletionLabel}
              </span>
            )}
          </div>
        </div>

        {/* Complete Circle */}
        <button
          onClick={handleCircleClick}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={completedToday}
          className={cn(
            "shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
            "transition-all duration-200 ease-bounce",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand",
            completedToday
              ? "bg-success text-white"
              : "border-2 border-gray-300 hover:border-success hover:bg-success/10 active:scale-90",
          )}
          aria-label={
            completedToday
              ? `${habit.title} completed`
              : `Complete ${habit.title}`
          }
        >
          {completedToday && (
            <div className="animate-[landing-pop_0.3s_var(--ease-bounce)_both]">
              <Check className="w-5 h-5" strokeWidth={3} />
            </div>
          )}
        </button>
      </div>
    </div>
  );
});
