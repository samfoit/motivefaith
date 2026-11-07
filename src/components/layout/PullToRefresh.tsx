"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

/** Finger travel before a drag counts as a pull rather than a tap. */
const SLOP_PX = 8;
/** The indicator follows the finger at half its pace. */
const DAMPING = 0.5;
/** How far the indicator has to come down for a release to refresh. */
const TRIGGER_PX = 64;
/** The farthest it follows the finger. */
const MAX_PULL_PX = 96;
/** The indicator's size, and its resting place tucked behind the top bar. */
const SIZE_PX = 36;
const HIDDEN_Y = -(SIZE_PX + 8);
/** Where it waits, just below the bar, while the screen refreshes. */
const REFRESHING_Y = HIDDEN_Y + TRIGGER_PX;
/** A refresh that lands at once still shows that it happened. */
const MIN_REFRESH_MS = 500;
/** Offline, the refetches wait for a connection; the indicator doesn't. */
const MAX_REFRESH_MS = 8000;

const STANDALONE = "(display-mode: standalone)";

/** Installed to the home screen, where there is no reload button or gesture. */
function isInstalledApp(): boolean {
  return (
    window.matchMedia(STANDALONE).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function subscribeDisplayMode(onChange: () => void) {
  const query = window.matchMedia(STANDALONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True when a drag from here would scroll something else rather than pull:
 * a form field, or a list of its own that isn't at its top.
 */
function belongsToSomethingElse(target: Element, area: Element): boolean {
  if (target.closest("input, textarea, select, [contenteditable='true']")) return true;
  for (let el: Element | null = target; el && el !== area; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
  }
  return false;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Moves the indicator. Written to the node rather than through state: it
 * follows the finger, and a render per touchmove would lag it. `animate` is
 * false while it does.
 */
function place(
  indicator: HTMLElement | null,
  y: number,
  opacity: number,
  animate: boolean,
) {
  if (!indicator) return;
  indicator.style.transition = animate ? "" : "none";
  indicator.style.transform = `translate3d(0, ${y}px, 0)`;
  indicator.style.opacity = String(opacity);
}

/**
 * Pull down from the top of a screen to refresh it, in the installed app.
 *
 * A browser tab has its own pull to reload. The installed app has none, and
 * no reload button either, so a screen left open, with a habit made on
 * another device since, had no way to catch up short of switching away and
 * back. This brings the gesture back: it refetches the screen's data and
 * re-renders its server parts, without reloading the page. A reload would
 * blank the screen to restore it, and drop whatever was held, like a check-in
 * in its undo window.
 *
 * Only a drag that starts in the page content counts: not the top bar, a
 * sheet, the camera, or a list that can still scroll up. The page's own
 * overscroll is turned off while this is mounted, so the iPhone's bounce and
 * Chrome's own pull don't act on the same drag.
 *
 * Rendered inside <main>, which is the area it listens over.
 */
export function PullToRefresh() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const installed = useSyncExternalStore(subscribeDisplayMode, isInstalledApp, () => false);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);
  const [fetching, setFetching] = useState(false);
  const [rendering, startRendering] = useTransition();
  const busy = fetching || rendering;

  const refresh = useEffectEvent(async () => {
    if (busy) return;
    setFetching(true);
    const started = Date.now();
    // Offline, a failed refresh falls back to loading the page from scratch,
    // which lands on the offline page; the saved data is better than that.
    if (navigator.onLine) startRendering(() => router.refresh());
    // On screen now, and everything else as it next mounts.
    await Promise.race([queryClient.invalidateQueries(), wait(MAX_REFRESH_MS)]);
    await wait(MIN_REFRESH_MS - (Date.now() - started));
    setFetching(false);
  });

  const isBusy = useEffectEvent(() => busy);

  useEffect(() => {
    if (busy) {
      if (iconRef.current) iconRef.current.style.transform = "";
      place(indicatorRef.current, REFRESHING_Y, 1, true);
    } else {
      place(indicatorRef.current, HIDDEN_Y, 0, true);
    }
  }, [busy]);

  useEffect(() => {
    const indicator = indicatorRef.current;
    const area = indicator?.parentElement;
    if (!installed || !area) return;

    const root = document.documentElement;
    const overscroll = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "none";

    let tracking = false;
    let pulling = false;
    let startX = 0;
    let startY = 0;
    let pull = 0;

    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (e.touches.length !== 1 || window.scrollY > 0 || isBusy()) return;
      const target = e.target;
      if (!(target instanceof Element) || !area.contains(target)) return;
      if (belongsToSomethingElse(target, area)) return;
      tracking = true;
      pulling = false;
      pull = 0;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!pulling) {
        // Sideways is a habit's check-in drawer; up is scrolling the page.
        if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy)) tracking = false;
        if (dy < -SLOP_PX) tracking = false;
        if (!tracking || dy < SLOP_PX) return;
        pulling = true;
      }
      pull = Math.min(MAX_PULL_PX, Math.max(0, (dy - SLOP_PX) * DAMPING));
      place(indicator, HIDDEN_Y + pull, Math.min(1, pull / (TRIGGER_PX * 0.75)), false);
      if (iconRef.current) {
        iconRef.current.style.transform = `rotate(${(pull / TRIGGER_PX) * 270}deg)`;
      }
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!pulling) return;
      if (pull >= TRIGGER_PX) void refresh();
      else place(indicator, HIDDEN_Y, 0, true);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      root.style.overscrollBehaviorY = overscroll;
    };
  }, [installed]);

  return (
    <>
      <div
        ref={indicatorRef}
        aria-hidden
        className="pointer-events-none fixed left-1/2 top-14 z-30 flex items-center justify-center rounded-full border border-border bg-elevated text-brand-ink shadow-sm transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: SIZE_PX,
          height: SIZE_PX,
          marginLeft: -SIZE_PX / 2,
          transform: `translate3d(0, ${HIDDEN_Y}px, 0)`,
          opacity: 0,
        }}
      >
        <RefreshCw
          ref={iconRef}
          className={busy ? "w-4 h-4 motion-safe:animate-spin" : "w-4 h-4"}
          strokeWidth={2.25}
        />
      </div>
      <span role="status" className="sr-only">
        {busy ? "Refreshing" : ""}
      </span>
    </>
  );
}
