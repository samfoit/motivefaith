"use client";

import React, { useRef, useCallback, useEffect, useId } from "react";
import { Clock, CloudRain, CornerDownRight } from "lucide-react";
import { differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { CHECK_IN_OPTIONS, type CheckInAction } from "@/lib/constants/check-in";
import { isRainCheck } from "@/lib/constants/completion";
import { useHabitDrawerStore } from "@/lib/stores/habit-drawer-store";
import {
  CheckInDrawerOptions,
  DRAWER_SURFACE_CLASS,
  DRAWER_SURFACE_STYLE,
  DrawerHandle,
  REPEAT_OPTIONS,
  originOf,
  useCheckInDrawer,
} from "@/components/habits/CheckInDrawer";
import {
  HabitCircle,
  HabitTitleRow,
  habitSurfaceProps,
} from "@/components/habits/HabitCardParts";
import type { Tables } from "@/lib/supabase/types";
import type { Habit } from "@/lib/types/habit";
import type { HabitPause } from "@/lib/utils/pauses";
import type { ScheduleChange } from "@/lib/utils/schedule";

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
  /**
   * Pauses reaching into the dashboard's window, for days it shows. Absent
   * from a cache written before they were sent.
   */
  pauses?: HabitPause[];
  /**
   * Changes to its schedule since the start of that window, so a day it
   * shows is judged by the schedule it had. Absent from a cache written
   * before they were sent.
   */
  schedule_changes?: ScheduleChange[];
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
  /**
   * When today's window opens, as the card shows it ("9 AM"). Today's
   * rather than the habit's: a habit can keep a different time on some days.
   */
  startTime?: string | null;
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
  startTime = null,
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

  const challengeNameIsTitle =
    habit.challenge?.title.trim().toLowerCase() ===
    habit.title.trim().toLowerCase();

  // --- Check-in drawer -----------------------------------------------------

  const drawerId = useId();
  // Still offered once the habit is done for the day, without the rain check:
  // see REPEAT_OPTIONS.
  const drawerEnabled = !!onCheckIn;
  const options = completedToday ? REPEAT_OPTIONS : CHECK_IN_OPTIONS;

  const drawerRef = useRef<HTMLDivElement>(null);
  const peekAnimationsRef = useRef<Animation[]>([]);

  // Touching the card mid-peek hands it straight back to the user.
  const cancelPeek = useCallback(() => {
    for (const a of peekAnimationsRef.current) a.cancel();
    peekAnimationsRef.current = [];
  }, []);

  const {
    isOpen,
    toggle: toggleDrawer,
    close: closeDrawer,
    trackRef,
    surfaceRef,
    dragRef,
    consumeDragClick,
    trackHandlers,
  } = useCheckInDrawer({
    habitId: habit.id,
    enabled: drawerEnabled,
    optionCount: options.length,
    onTouch: cancelPeek,
  });

  const handleCircleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (consumeDragClick() || completedToday) return;
    // Checking in from the circle settles the card, open drawer and all.
    closeDrawer();
    onQuickComplete(habit.id, originOf(e));
  };

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
          { transform: `translate3d(-${PEEK_PX}px, 0, 0)`, offset: 0.25 },
          { transform: `translate3d(-${PEEK_PX}px, 0, 0)`, offset: 0.7, easing: ease },
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
      cancelPeek();
    };
  }, [peek, drawerEnabled, surfaceRef, dragRef, cancelPeek]);

  const handleClick = useCallback(() => {
    if (consumeDragClick()) return;
    if (isOpen) {
      closeDrawer();
      return;
    }
    onPress?.(habit.id);
  }, [consumeDragClick, isOpen, habit.id, closeDrawer, onPress]);

  const handleCheckIn = useCallback(
    (action: CheckInAction, e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (consumeDragClick()) return;
      closeDrawer();
      onCheckIn?.(habit.id, action, originOf(e));
    },
    [habit.id, closeDrawer, onCheckIn, consumeDragClick],
  );

  return (
    <div
      ref={trackRef}
      className={cn("hc-drawer relative overflow-hidden rounded-lg", className)}
      style={{ ["--habit-color" as string]: habit.color ?? undefined } as React.CSSProperties}
      {...trackHandlers}
    >
      {/* Check-in drawer, revealed as the card slides off it */}
      {drawerEnabled && (
        <CheckInDrawerOptions
          ref={drawerRef}
          id={drawerId}
          habitTitle={habit.title}
          options={options}
          isOpen={isOpen}
          onPick={handleCheckIn}
        />
      )}

      {/* Card surface */}
      <div
        ref={surfaceRef}
        // The tinted surface also gives the drawer an opaque face to hide behind.
        {...habitSurfaceProps(habit.color, {
          className: cn(
            DRAWER_SURFACE_CLASS,
            // Circle first; the handle last, beside the drawer it opens, and
            // the strip of card left on screen while the drawer is open.
            "gap-3 pl-4 pr-2 cursor-pointer select-none active:brightness-[0.98]",
          ),
          style: DRAWER_SURFACE_STYLE,
        })}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleClick}
      >
        {/* Complete Circle */}
        <button
          onClick={handleCircleClick}
          // aria-disabled rather than disabled: a disabled button swallows
          // the pointer events a drag starting on it needs.
          aria-disabled={completedToday}
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
            {startTime && (
              <span className="text-xs text-text-secondary flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {startTime}
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

        {/* Drawer handle */}
        {drawerEnabled ? (
          <DrawerHandle
            isOpen={isOpen}
            drawerId={drawerId}
            habitTitle={habit.title}
            onToggle={() => {
              if (!consumeDragClick()) toggleDrawer();
            }}
            className="-my-1"
          />
        ) : (
          <div className="shrink-0 w-7" aria-hidden />
        )}

      </div>
    </div>
  );
});
