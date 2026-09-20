"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, Suspense, useCallback } from "react";

function NavigationProgressInner() {
  const pathname = usePathname();
  // The pathname we were on when a navigation started, recorded only once the
  // click has been pending long enough to be worth showing a bar for.
  //
  // Whether the bar is visible is *derived* from this rather than stored: a
  // navigation is still in flight exactly while we are still on the page it
  // started from. Deriving it avoids a setState in an effect (which would
  // cascade an extra render on every route change) and cannot drift out of
  // sync with the router.
  //
  // Storing the origin rather than the destination matters: a left-over
  // destination would differ from the current pathname and so read as "still
  // loading" forever. An origin has the opposite failure mode but still has
  // one, which is why it is cleared on arrival below: left in place it matches
  // again the moment the user comes back to that page (browser back, or a
  // prefetched link that resolves inside the delay), lighting the bar with no
  // navigation in flight and no timer left to take it down.
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [arrivedAt, setArrivedAt] = useState(pathname);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Route changed → the navigation is over and the recorded origin is spent.
  // Adjusted during render rather than in an effect: React re-runs this
  // component with the new state before committing anything, so the reset
  // costs no extra committed render and no children re-render — which is the
  // cost the derivation above exists to avoid.
  if (pathname !== arrivedAt) {
    setArrivedAt(pathname);
    setPendingFrom(null);
  }

  const loading = pendingFrom !== null && pendingFrom === pathname;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // The other half of arrival: cancel the pending timer, so a click that
  // resolved faster than the delay can't light the bar once we are already
  // there.
  useEffect(() => {
    clearTimer();
  }, [pathname, clearTimer]);

  // Detect internal link clicks
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!a || a.target === "_blank") return;

      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      let url: URL;
      try {
        url = new URL(href, location.origin);
      } catch {
        return;
      }
      if (url.origin !== location.origin || url.pathname === pathname) return;

      clearTimer();
      // Delay so cached (instant) navigations don't flash the bar
      const origin = pathname;
      timerRef.current = setTimeout(() => setPendingFrom(origin), 120);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimer();
    };
  }, [pathname, clearTimer]);

  if (!loading) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]"
    >
      <div className="nav-progress-bar h-full bg-[var(--color-brand)]" />
    </div>
  );
}

export function NavigationProgress() {
  return (
    <Suspense>
      <NavigationProgressInner />
    </Suspense>
  );
}
