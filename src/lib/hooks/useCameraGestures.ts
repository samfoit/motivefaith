"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Two taps closer together than this count as a double tap. */
const DOUBLE_TAP_MS = 300;
/** ...and only if the second tap lands near the first. */
const DOUBLE_TAP_SLOP_PX = 44;
/** A press that drifts further than this is a drag, not a tap. */
const TAP_SLOP_PX = 12;
/** A press held longer than this is not a tap either. */
const TAP_MAX_MS = 400;
/** A downward flick must travel at least this far... */
const SWIPE_MIN_PX = 90;
/** ...within this long, and stay mostly vertical. */
const SWIPE_MAX_MS = 700;
/** Horizontal drift is allowed up to this fraction of the vertical travel. */
const SWIPE_VERTICALITY = 0.66;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseCameraGesturesOptions {
  /** When false every gesture is ignored (e.g. mid-recording). */
  enabled?: boolean;
  /** Double tap on the viewfinder — flips the camera. */
  onDoubleTap?: () => void;
  /** A two-finger pinch began; `onPinch` scales are relative to this moment. */
  onPinchStart?: () => void;
  /** Pinch in progress. `scale` is 1 at the start, >1 spreading, <1 closing. */
  onPinch?: (scale: number) => void;
  onPinchEnd?: () => void;
  /** A downward flick — dismisses the camera. */
  onSwipeDown?: () => void;
}

export interface CameraGestureHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

export interface UseCameraGesturesReturn {
  /** Spread onto the element that should listen — usually the viewfinder. */
  handlers: CameraGestureHandlers;
  /** True while two fingers are down, for showing a zoom read-out. */
  isPinching: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface TapCandidate extends Point {
  id: number;
  t: number;
  moved: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Touch gestures for a full-screen viewfinder, in the idiom people already
 * know from Snapchat and the system camera:
 *
 *   - **double tap** — flip between front and back cameras
 *   - **pinch** — zoom
 *   - **swipe down** — dismiss
 *
 * Everything runs off pointer events, so a mouse drives the same code paths as
 * a finger, and each gesture cancels the others: a second finger landing voids
 * the tap in progress, and a press that drifts is never mistaken for a tap.
 *
 * The callbacks are read through a ref, so passing fresh closures on every
 * render costs nothing — the returned handlers are stable for the life of the
 * component and never re-subscribe.
 */
export function useCameraGestures(
  options: UseCameraGesturesOptions,
): UseCameraGesturesReturn {
  const { enabled = true } = options;

  // Latest callbacks, without making the handlers depend on them. Gestures are
  // only ever read from a pointer event, which is long after this commit.
  const optsRef = useRef(options);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    optsRef.current = options;
    enabledRef.current = enabled;
  });

  const [isPinching, setIsPinching] = useState(false);

  const pointers = useRef(new Map<number, Point>());
  const tap = useRef<TapCandidate | null>(null);
  const lastTap = useRef<(Point & { t: number }) | null>(null);
  const pinchStartDistance = useRef(0);
  const pinchingRef = useRef(false);

  // --- Distance between the two oldest pointers ---
  const spread = useCallback((): number => {
    const [a, b] = Array.from(pointers.current.values());
    return a && b ? distance(a, b) : 0;
  }, []);

  const endPinch = useCallback(() => {
    if (!pinchingRef.current) return;
    pinchingRef.current = false;
    setIsPinching(false);
    optsRef.current.onPinchEnd?.();
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabledRef.current) return;

      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size === 1) {
        tap.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          t: e.timeStamp,
          moved: false,
        };
        return;
      }

      // A second finger: this is a pinch, not a tap.
      tap.current = null;
      lastTap.current = null;

      if (pointers.current.size === 2 && !pinchingRef.current) {
        pinchStartDistance.current = spread();
        if (pinchStartDistance.current > 0) {
          pinchingRef.current = true;
          setIsPinching(true);
          optsRef.current.onPinchStart?.();
        }
      }
    },
    [spread],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchingRef.current) {
      const now = spread();
      if (now > 0 && pinchStartDistance.current > 0) {
        optsRef.current.onPinch?.(now / pinchStartDistance.current);
      }
      return;
    }

    const candidate = tap.current;
    if (candidate && candidate.id === e.pointerId && !candidate.moved) {
      if (distance(candidate, { x: e.clientX, y: e.clientY }) > TAP_SLOP_PX) {
        candidate.moved = true;
      }
    }
  }, [spread]);

  const settle = useCallback(
    (e: React.PointerEvent, completed: boolean) => {
      pointers.current.delete(e.pointerId);

      if (pinchingRef.current && pointers.current.size < 2) {
        endPinch();
        tap.current = null;
        return;
      }

      const candidate = tap.current;
      if (!completed || !candidate || candidate.id !== e.pointerId) {
        if (pointers.current.size === 0) tap.current = null;
        return;
      }
      tap.current = null;

      const dt = e.timeStamp - candidate.t;
      const dx = e.clientX - candidate.x;
      const dy = e.clientY - candidate.y;

      // --- Tap (possibly the second half of a double tap) ---
      if (!candidate.moved && dt <= TAP_MAX_MS) {
        const here = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        const previous = lastTap.current;

        if (
          previous &&
          here.t - previous.t <= DOUBLE_TAP_MS &&
          distance(previous, here) <= DOUBLE_TAP_SLOP_PX
        ) {
          lastTap.current = null;
          optsRef.current.onDoubleTap?.();
        } else {
          lastTap.current = here;
        }
        return;
      }

      // --- Downward flick ---
      if (
        dy >= SWIPE_MIN_PX &&
        dt <= SWIPE_MAX_MS &&
        Math.abs(dx) <= dy * SWIPE_VERTICALITY
      ) {
        lastTap.current = null;
        optsRef.current.onSwipeDown?.();
      }
    },
    [endPinch],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => settle(e, true), [settle]);
  const onPointerCancel = useCallback((e: React.PointerEvent) => settle(e, false), [settle]);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    isPinching,
  };
}
