"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import {
  CHECK_IN_OPTIONS,
  type CheckInAction,
  type CheckInOption,
} from "@/lib/constants/check-in";
import { useHabitDrawerStore } from "@/lib/stores/habit-drawer-store";

/**
 * The check-in drawer: a habit's surface slides left off a row of check-in
 * icons. The Day view's cards and the Week and Month views' rows share it, so
 * the gesture works the same wherever a habit is listed.
 *
 * Left, not right: a rightward swipe that starts near the screen's edge is the
 * browser's own "go back" gesture.
 */

// --- Geometry --------------------------------------------------------------
// The surface slides by exactly the width of the option row, so the icons end
// up in the space it vacated.
const OPTION_SIZE = 40;
const OPTION_GAP = 8;
const DRAWER_PADDING = 12;
/** Strip of surface kept on screen on narrow phones, so it stays grabbable. */
const MIN_SURFACE_VISIBLE = 64;
/** Pointer travel before a gesture commits to horizontal (vs. page scroll). */
const DIRECTION_LOCK_PX = 8;
/** Fraction of the reveal a drag must cover to settle open. */
const OPEN_RATIO = 0.4;

/** How far the surface slides to uncover a row of `count` options. */
function revealFor(count: number): number {
  return DRAWER_PADDING * 2 + count * OPTION_SIZE + (count - 1) * OPTION_GAP;
}

/**
 * The drawer once the habit is done for the day. Doing it again is still a
 * check-in, of any kind; only skipping it is off the table by then.
 */
export const REPEAT_OPTIONS = CHECK_IN_OPTIONS.filter((o) => o.action !== "rain_check");

/**
 * Resolved by the browser against the surface's own width, so no measurement
 * is needed for the resting state — only the live drag clamps in pixels.
 */
function openTransform(revealPx: number): string {
  return `translate3d(max(-${revealPx}px, calc(${MIN_SURFACE_VISIBLE}px - 100%)), 0, 0)`;
}

/** The class that animates the surface's settle; the drag itself is unanimated. */
export const DRAWER_SURFACE_CLASS =
  "hc-surface transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";

/** Touch styles the surface needs: the page still scrolls vertically through it. */
export const DRAWER_SURFACE_STYLE: React.CSSProperties = {
  touchAction: "pan-y",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
};

interface UseCheckInDrawerOptions {
  habitId: string;
  enabled: boolean;
  /** How many options the drawer holds: sets how far the surface slides. */
  optionCount: number;
  /** A touch on the surface, before anything else: cancels a running peek. */
  onTouch?: () => void;
}

export function useCheckInDrawer({
  habitId,
  enabled,
  optionCount,
  onTouch,
}: UseCheckInDrawerOptions) {
  const isOpen = useHabitDrawerStore((s) => s.openHabitId === habitId);
  const openDrawer = useHabitDrawerStore((s) => s.open);
  const closeDrawer = useHabitDrawerStore((s) => s.close);
  const revealPx = revealFor(optionCount);

  const trackRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => closeDrawer(habitId), [closeDrawer, habitId]);
  const toggle = useCallback(() => {
    if (isOpen) closeDrawer(habitId);
    else openDrawer(habitId);
  }, [isOpen, habitId, openDrawer, closeDrawer]);

  // The transform lives on the DOM node rather than in the style prop: a drag
  // writes it every pointermove, and routing that through React would
  // re-render the row on every frame of the gesture.
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

  /**
   * A drag can start on any button in the row, so the click that ends it must
   * not count as a press. True, once, when the click closes a drag.
   */
  const consumeDragClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node || dragRef.current.locked) return;
    node.style.transition = "";
    // Re-run when the row narrows too: a habit done for the day, with its
    // drawer open, loses the rain check from under the surface.
    node.style.transform = isOpen && enabled ? openTransform(revealPx) : "";
  }, [isOpen, enabled, revealPx]);

  // An open drawer is a transient mode: Escape or a tap anywhere else ends it.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer(habitId);
    };
    const onPointerDownOutside = (e: PointerEvent) => {
      if (!trackRef.current?.contains(e.target as Node)) closeDrawer(habitId);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDownOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDownOutside);
    };
  }, [isOpen, habitId, closeDrawer]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      onTouch?.();
      if (!enabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const track = trackRef.current;
      if (!track) return;
      // Cleared here rather than only on click: a gesture that ends in a
      // pointercancel never produces a click to clear it, and a stale flag
      // would swallow the next genuine tap.
      suppressClickRef.current = false;
      const reveal = Math.max(
        0,
        Math.min(revealPx, track.clientWidth - MIN_SURFACE_VISIBLE),
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
    [enabled, isOpen, revealPx, onTouch],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
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

    // How much of the drawer is uncovered: dragging left uncovers it.
    const offset = Math.min(drag.reveal, Math.max(0, drag.base - dx));
    if (surfaceRef.current) {
      surfaceRef.current.style.transform = `translate3d(${-offset}px, 0, 0)`;
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
        Math.max(0, drag.base - (e.clientX - drag.startX)),
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
      if (shouldOpen) openDrawer(habitId);
      else closeDrawer(habitId);
    },
    [habitId, revealPx, openDrawer, closeDrawer],
  );

  return {
    isOpen,
    toggle,
    close,
    trackRef,
    surfaceRef,
    dragRef,
    consumeDragClick,
    /**
     * Spread on the track, not the surface: a drag may start on any of the
     * surface's buttons, or on the open drawer's options to push it back.
     */
    trackHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}

interface CheckInDrawerOptionsProps {
  id?: string;
  habitTitle: string;
  options: readonly CheckInOption[];
  isOpen: boolean;
  onPick: (action: CheckInAction, e: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * The row of check-in icons behind the surface. Reversed so the first option
 * sits at the right edge — the first one the sliding surface clears.
 */
export const CheckInDrawerOptions = React.forwardRef<
  HTMLDivElement,
  CheckInDrawerOptionsProps
>(function CheckInDrawerOptions({ id, habitTitle, options, isOpen, onPick }, ref) {
  return (
    <div
      ref={ref}
      id={id}
      inert={!isOpen}
      className="absolute inset-y-0 right-0 flex flex-row-reverse items-center"
      style={{ gap: OPTION_GAP, paddingInline: DRAWER_PADDING, touchAction: "pan-y" }}
    >
      {options.map((option, i) => (
        <button
          key={option.action}
          type="button"
          onClick={(e) => onPick(option.action, e)}
          aria-label={`${option.label} for ${habitTitle}`}
          className={cn(
            "hc-option shrink-0 rounded-full text-white shadow-sm",
            "flex items-center justify-center",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-ink",
          )}
          style={{
            width: OPTION_SIZE,
            height: OPTION_SIZE,
            backgroundColor: option.color,
            // Icons land one after another as the surface clears them. The
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
  );
});

/** Where a pick happened, for the check-in's celebration to start from. */
export function originOf(e: React.MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
