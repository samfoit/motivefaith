"use client";

import { useCallback, useLayoutEffect } from "react";

/**
 * Opens a message thread at its newest message, and hands back the same jump
 * for later use (a message sent, or one arriving over realtime).
 *
 * Scrolls the page to its full height rather than into view of a marker at the
 * end of the list: the thread reserves padding underneath for the composer
 * that floats over it, and only scrolling past that padding leaves the last
 * message clear of the bar.
 *
 * The first jump runs before paint, so the thread is never seen at the top and
 * then yanked down. It repeats once on the next frame because a bubble's media
 * can settle its height a frame late, which would otherwise leave the view a
 * little short of the end.
 */
export function useScrollToLatest() {
  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: reduceMotion ? "auto" : behavior,
    });
  }, []);

  useLayoutEffect(() => {
    scrollToLatest();
    const frame = requestAnimationFrame(() => scrollToLatest());
    return () => cancelAnimationFrame(frame);
  }, [scrollToLatest]);

  return scrollToLatest;
}
