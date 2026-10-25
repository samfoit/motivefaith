"use client";

import React, { useRef, useCallback, useEffect, useId } from "react";
import { ChevronRight, Clock, CloudRain, CornerDownRight } from "lucide-react";
import { differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { CHECK_IN_OPTIONS, type CheckInAction } from "@/lib/constants/check-in";
import { isRainCheck } from "@/lib/constants/completion";
import { useHabitDrawerStore } from "@/lib/stores/habit-drawer-store";
import { formatStartTime } from "@/lib/utils/schedule";
import {
  HabitCircle,
  HabitTitleRow,
  habitSurfaceProps,
} from "@/components/habits/HabitCardParts";
import type { Tables } from "@/lib/supabase/types";
import type { Habit } from "@/lib/types/habit";

// --- Drawer geometry -------------------------------------------------------
// The card slides right by exactly the width of the option row, so the icons
// end up in the space the card vacated.
const OPTION_SIZE = 40;
const OPTION_GAP = 8;
const DRAWER_PADDING = 12;
/** How far the card slides to uncover a row of `count` options. */
function revealFor(count: number): number {
  return DRAWER_PADDING * 2 + count * OPTION_SIZE + (count - 1) * OPTION_GAP;
}
/**
 * The drawer once the habit is done for the day. Doing it again is still a
 * check-in, of any kind; only skipping it is off the table by then.
 */
const REPEAT_OPTIONS = CHECK_IN_OPTIONS.filter((o) => o.action !== "rain_check");
/** Strip of card kept on screen on narrow phones, so it stays grabbable. */
const MIN_CARD_VISIBLE = 64;
/** Pointer travel before a gesture commits to horizontal (vs. page scroll). */
const DIRECTION_LOCK_PX = 8;
/** Fraction of the reveal a drag must cover to settle open. */
const OPEN_RATIO = 0.4;

/**
 * The one-time peek: how far the card slides on its own to show what is
 * behind it — enough to uncover "Quick check-in" and the edge of the next
 * option, so it reads as a row of choices rather than a single button.
 */
const PEEK_PX = 72;
/** Lets the list's entrance stagger finish before anything else moves. */
const PEEK_DELAY_MS = 1200;
const PEEK_DURATION_MS = 1700;
const PEEK_SEEN_KEY = "motive-drawer-peek-seen";

/** Per device: someone who has seen the drawer does not need it shown again. */
function hasSeenDrawerPeek(): boolean {
  try {
    return localStorage.getItem(PEEK_SEEN_KEY) === "1";
  } catch {
    // Storage blocked: treat as seen rather than replay it on every visit.
    return true;
  }
}

function markDrawerPeekSeen() {
  try {
    localStorage.setItem(PEEK_SEEN_KEY, "1");
  } catch {
    // Nothing to do — it simply may play again next time.
  }
}

/**
 * Resolved by the browser against the card's own width, so no measurement is
 * needed for the resting state — only the live drag clamps in pixels.
 */
function openTransform(revealPx: number): string {
  return `translate3d(min(${revealPx}px, calc(100% - ${MIN_CARD_VISIBLE}px)), 0, 0)`;
}

/** Calendar days, not 24-hour periods: last night at 11pm is "yesterday". */
function formatLastDone(at: Date): string {
  const days = differenceInCalendarDays(new Date(), at);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

type CompletionSlice = {
  id: string;
  completed_at: string;
  completion_type: Tables<"completions">["completion_type"];
  rain_check_moved_to?: Tables<"completions">["rain_check_moved_to"];
};

export type HabitWithCompletions = Habit & {
  completions: CompletionSlice[];
  challenge?: { title: string; emoji: string } | null;
};

interface HabitCardProps {
  habit: HabitWithCompletions;
  completedToday: boolean;
  /**
   * Real check-ins logged today. From the second one on the card says how
   * many — the filled circle can only say that the day is done.
   */
  checkInsToday?: number;
  /**
   * Today was rain-checked: the streak is safe and the day is accounted for,
   * but unlike a completion it does not close the habit off — the user can
   * still change their mind and actually do it.
   */
  rainCheckedToday?: boolean;
  /**
   * The day today's rain check was moved to, as a weekday name ("Thursday").
   * Set only alongside `rainCheckedToday`, and only when it was moved rather
   * than plainly skipped.
   */
  rainCheckMovedTo?: string | null;
  /**
   * This card is a makeup: the habit is not normally scheduled today, it is
   * here because an earlier rain check promised it. The weekday it moved from
   * ("Wednesday"), for the pill.
   */
  movedFrom?: string | null;
  onQuickComplete: (habitId: string, origin?: { x: number; y: number }) => void;
  onPress?: (habitId: string) => void;
  /** Fired when a check-in icon is picked from the drawer. */
  onCheckIn?: (
    habitId: string,
    action: CheckInAction,
    origin?: { x: number; y: number },
  ) => void;
  /**
   * Slide open a little and back once, the first time this device shows the
   * dashboard, so people learn the check-in drawer exists. Without it the
   * photo, voice and note options sit behind a gesture nobody has reason to
   * try. DayView sets it on one card only.
   */
  peek?: boolean;
  className?: string;
}

export const HabitCard = React.memo(function HabitCard({
  habit,
  completedToday,
  checkInsToday = 0,
  rainCheckedToday = false,
  rainCheckMovedTo = null,
  movedFrom = null,
  onQuickComplete,
  onPress,
  onCheckIn,
  peek = false,
  className,
}: HabitCardProps) {
  // "Last done", spelled out: a bare "11 days ago" did not say what happened
  // then. A rain check is not doing it, so it does not count. Hidden once the
  // habit is done today — the filled circle already says so.
  const lastDone = habit.completions.reduce<Date | null>((latest, c) => {
    if (isRainCheck(c.completion_type)) return latest;
    const at = new Date(c.completed_at);
    return !latest || at > latest ? at : latest;
  }, null);

  const lastCompletionLabel =
    lastDone && !completedToday ? `Last done ${formatLastDone(lastDone)}` : null;

  const timeWindow = habit.time_window as { start?: string; end?: string } | null;
  const scheduledTime = formatStartTime(timeWindow?.start);

  const challengeNameIsTitle =
    habit.challenge?.title.trim().toLowerCase() ===
    habit.title.trim().toLowerCase();

  // --- Check-in drawer -----------------------------------------------------

  const drawerId = useId();
  const isOpen = useHabitDrawerStore((s) => s.openHabitId === habit.id);
  const openDrawer = useHabitDrawerStore((s) => s.open);
  const closeDrawer = useHabitDrawerStore((s) => s.close);
  // Still offered once the habit is done for the day, without the rain check:
  // see REPEAT_OPTIONS.
  const drawerEnabled = !!onCheckIn;
  const options = completedToday ? REPEAT_OPTIONS : CHECK_IN_OPTIONS;
  const revealPx = revealFor(options.length);

  const trackRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const peekAnimationsRef = useRef<Animation[]>([]);

  const toggleDrawer = useCallback(() => {
    if (isOpen) closeDrawer(habit.id);
    else openDrawer(habit.id);
  }, [isOpen, habit.id, openDrawer, closeDrawer]);

  const handleCircleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completedToday) return;
    // Checking in from the circle settles the card, open drawer and all.
    closeDrawer(habit.id);
    const rect = e.currentTarget.getBoundingClientRect();
    onQuickComplete(habit.id, {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

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
    // Re-run when the row narrows too: a habit done for the day, with its
    // drawer open, loses the rain check from under the card.
    node.style.transform = isOpen && drawerEnabled ? openTransform(revealPx) : "";
  }, [isOpen, drawerEnabled, revealPx]);

  // Opening the drawer by hand teaches more than the peek would.
  useEffect(() => {
    if (isOpen) markDrawerPeekSeen();
  }, [isOpen]);

  useEffect(() => {
    if (!peek || !drawerEnabled || hasSeenDrawerPeek()) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setTimeout(() => {
      const node = surfaceRef.current;
      const drawer = drawerRef.current;
      if (!node || !drawer || typeof node.animate !== "function") return;
      // Not while the user is busy with a card or the page is in the background.
      if (
        document.visibilityState !== "visible" ||
        dragRef.current.active ||
        useHabitDrawerStore.getState().openHabitId
      ) {
        return;
      }
      markDrawerPeekSeen();
      const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
      const timing: KeyframeAnimationOptions = { duration: PEEK_DURATION_MS };
      const slide = node.animate(
        [
          { transform: "translate3d(0, 0, 0)", easing: ease },
          { transform: `translate3d(${PEEK_PX}px, 0, 0)`, offset: 0.25 },
          { transform: `translate3d(${PEEK_PX}px, 0, 0)`, offset: 0.7, easing: ease },
          { transform: "translate3d(0, 0, 0)" },
        ],
        timing,
      );
      // The icons are invisible while the drawer is shut; show them for the
      // length of the peek, the way they appear when it opens for real.
      const icons = [...drawer.querySelectorAll<HTMLElement>(".hc-option")].map(
        (icon, i) =>
          icon.animate(
            [
              { opacity: 0, transform: "scale(0.6)" },
              { opacity: 1, transform: "scale(1)", offset: 0.25 + i * 0.03 },
              { opacity: 1, transform: "scale(1)", offset: 0.7 },
              { opacity: 0, transform: "scale(0.6)", offset: 0.85 },
              { opacity: 0, transform: "scale(0.6)" },
            ],
            timing,
          ),
      );
      peekAnimationsRef.current = [slide, ...icons];
    }, PEEK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      for (const a of peekAnimationsRef.current) a.cancel();
      peekAnimationsRef.current = [];
    };
  }, [peek, drawerEnabled]);

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
      // Touching the card mid-peek hands it straight back to the user.
      for (const a of peekAnimationsRef.current) a.cancel();
      peekAnimationsRef.current = [];
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
        Math.min(revealPx, track.clientWidth - MIN_CARD_VISIBLE),
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
    [drawerEnabled, isOpen, revealPx],
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
        node.style.transform = shouldOpen ? openTransform(revealPx) : "";
      }
      if (shouldOpen) openDrawer(habit.id);
      else closeDrawer(habit.id);
    },
    [habit.id, revealPx, openDrawer, closeDrawer],
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
      className={cn("hc-drawer relative overflow-hidden rounded-lg", className)}
      style={{ ["--habit-color" as string]: habit.color ?? undefined } as React.CSSProperties}
    >
      {/* Check-in drawer, revealed as the card slides off it */}
      {drawerEnabled && (
        <div
          ref={drawerRef}
          id={drawerId}
          inert={!isOpen}
          className="absolute inset-y-0 left-0 flex items-center"
          style={{ gap: OPTION_GAP, paddingInline: DRAWER_PADDING }}
        >
          {options.map((option, i) => (
            <button
              key={option.action}
              type="button"
              onClick={(e) => handleCheckIn(option.action, e)}
              aria-label={`${option.label} for ${habit.title}`}
              className={cn(
                "hc-option shrink-0 rounded-full text-white shadow-sm",
                "flex items-center justify-center",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-ink",
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
        // The tinted surface also gives the drawer an opaque face to hide behind.
        {...habitSurfaceProps(habit.color, {
          className: cn(
            "cursor-pointer select-none",
            "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "active:brightness-[0.98]",
          ),
          style: {
            touchAction: "pan-y",
            WebkitTouchCallout: "none",
            WebkitTapHighlightColor: "transparent",
          },
        })}
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
            // 28px wide to keep the title close; the tap area reaches 44px.
            className={cn(
              "relative shrink-0 -my-1 w-7 h-11 flex items-center justify-center rounded-md after:absolute after:-inset-x-2 after:inset-y-0",
              "text-text-tertiary hover:text-text-secondary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
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
          <HabitTitleRow
            emoji={habit.emoji}
            title={habit.title}
            streak={habit.streak_current}
            frequency={habit.frequency}
            muted={completedToday || rainCheckedToday}
          />

          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {scheduledTime && (
              <span className="text-xs text-text-secondary flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {scheduledTime}
              </span>
            )}
            {/* A habit created from a challenge usually takes the
                challenge's name, and then the tag is just the title again.
                It still earns its place when the two differ — it is the only
                sign the habit came from a group. */}
            {habit.challenge && !challengeNameIsTitle && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-light text-brand-ink">
                {habit.challenge.emoji} {habit.challenge.title}
              </span>
            )}
            {/* Visibility is left to the habit's detail page: it is a setting,
                not something to act on from the dashboard. */}
            {rainCheckedToday && !completedToday && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                style={{
                  color: "var(--color-rain)",
                  backgroundColor:
                    "color-mix(in srgb, var(--color-rain) 14%, transparent)",
                }}
              >
                <CloudRain className="w-2.5 h-2.5" />
                {rainCheckMovedTo
                  ? `Moved to ${rainCheckMovedTo}`
                  : "Rain check"}
              </span>
            )}
            {/* A makeup earns a pill even once it is done: it explains why a
                Mon/Wed/Fri habit is sitting on a Thursday. */}
            {movedFrom && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                style={{
                  color: "var(--color-rain)",
                  backgroundColor:
                    "color-mix(in srgb, var(--color-rain) 14%, transparent)",
                }}
              >
                <CornerDownRight className="w-2.5 h-2.5" />
                Moved from {movedFrom}
              </span>
            )}
            {lastCompletionLabel && (
              <span className="text-xs text-text-secondary">
                {lastCompletionLabel}
              </span>
            )}
            {completedToday && checkInsToday > 1 && (
              <span className="text-xs text-text-secondary">
                {checkInsToday} check-ins today
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
            // after: stretches the 40px circle's tap area to 48px.
            "group relative shrink-0 rounded-full after:absolute after:-inset-1",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-ink",
            !completedToday && "active:scale-90 transition-transform",
          )}
          aria-label={
            completedToday
              ? `${habit.title} completed`
              : rainCheckedToday
                ? `${habit.title} rain-checked today — check in anyway`
                : `Complete ${habit.title}`
          }
        >
          <HabitCircle
            state={completedToday ? "done" : rainCheckedToday ? "rain" : "open"}
            animateDone
          />
        </button>
      </div>
    </div>
  );
});
