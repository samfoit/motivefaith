"use client";

import { useEffect, useRef, useState } from "react";

/** Nothing is shown for this long — fast work never flashes a skeleton. */
export const SKELETON_DELAY_MS = 200;
/** Once shown, a skeleton is held this long so it cannot blink. */
export const SKELETON_MIN_MS = 500;

/**
 * Timing hygiene for a client-controlled loading state.
 *
 * Returns whether a skeleton should currently be on screen, applying both
 * halves of the rule:
 *
 *   - **delay before show** — if `isLoading` clears within `SKELETON_DELAY_MS`,
 *     the skeleton is never shown. A flash of skeleton reads worse than a
 *     brief pause.
 *   - **minimum display** — once shown, it stays up for at least
 *     `SKELETON_MIN_MS` even if the data arrives sooner, so it never blinks.
 *
 * Thresholds and sources: see RESEARCH.md.
 *
 * Scope note: this can only be applied where React controls the swap — client
 * data fetching and lazily-imported components. A Suspense fallback streamed
 * from the server is torn down by React the instant the boundary resolves and
 * there is no API to hold it, so those get the delay half only (via the CSS
 * `.motive-skeleton-screen` reveal) — which is enough, because it is the
 * sub-200ms flashes that were the measured problem.
 */
export function useDelayedLoading(
  isLoading: boolean,
  { delayMs = SKELETON_DELAY_MS, minMs = SKELETON_MIN_MS } = {},
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    if (isLoading) {
      if (shownAt.current === null) {
        showTimer = setTimeout(() => {
          shownAt.current = Date.now();
          setVisible(true);
        }, delayMs);
      }
    } else if (shownAt.current !== null) {
      const remaining = minMs - (Date.now() - shownAt.current);
      const finish = () => {
        shownAt.current = null;
        setVisible(false);
      };
      if (remaining > 0) hideTimer = setTimeout(finish, remaining);
      else finish();
    }
    // The remaining case — not loading and never shown — needs no work:
    // `visible` and `shownAt` are only ever set together, so if the skeleton
    // was never shown then `visible` is already false.

    return () => {
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [isLoading, delayMs, minMs]);

  return visible;
}
