"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, Suspense, useCallback } from "react";

function NavigationProgressInner() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Route changed → navigation complete
  useEffect(() => {
    clearTimer();
    setLoading(false);
  }, [pathname, clearTimer]);

  // Detect internal link clicks
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!a || a.target === "_blank") return;

      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      try {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin || url.pathname === pathname) return;
      } catch {
        return;
      }

      clearTimer();
      // Delay so cached (instant) navigations don't flash the bar
      timerRef.current = setTimeout(() => setLoading(true), 120);
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
