"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether an element is on screen or within `margin` of it, kept up to date
 * as it scrolls in and out.
 *
 * For long lists that hold media: a row mounts its photo, video or audio only
 * while this is true, so years of entries never all load (or stay decoded) at
 * once. Where IntersectionObserver is missing the element counts as near, so
 * content still shows, just without the saving.
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  margin = "800px",
): boolean {
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: `${margin} 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, margin]);

  return near;
}
