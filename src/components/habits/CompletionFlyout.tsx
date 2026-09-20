"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const DURATION_MS = 750;

interface CompletionFlyoutProps {
  active: boolean;
  emoji: string;
  /** Viewport coordinates where the animation starts (e.g. the checkmark button). */
  from?: { x: number; y: number };
  onDone: () => void;
}

/**
 * Animates a habit emoji flying from the center of the screen to the Feed
 * icon in the bottom nav, giving visual feedback that the completion is
 * being sent to accountability partners.
 *
 * Both endpoints can only be known by measuring the live DOM — the Feed icon
 * belongs to BottomNav — so they are written straight onto the node in a
 * layout effect rather than round-tripped through state. That keeps the
 * measurement out of render, saves a render pass per flight, and removes the
 * need to clear stale coordinates when a flight ends: there are none to clear.
 */
export function CompletionFlyout({
  active,
  emoji,
  from,
  onDone,
}: CompletionFlyoutProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const fromX = from?.x;
  const fromY = from?.y;

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!active || !node) return;

    // Find the Feed icon in the bottom nav
    const feedEl = document.querySelector<HTMLElement>("[data-nav='feed']");
    if (!feedEl) {
      // No feed icon visible — nothing to fly to, so skip the animation.
      // Deferred to a microtask so the parent isn't updated mid-commit.
      queueMicrotask(onDone);
      return;
    }

    const feedRect = feedEl.getBoundingClientRect();
    const feedX = feedRect.left + feedRect.width / 2;
    const feedY = feedRect.top + feedRect.height / 2;

    // Start from the provided origin (e.g. checkmark button) or center of viewport
    const startX = fromX ?? window.innerWidth / 2;
    const startY = fromY ?? window.innerHeight * 0.5;

    node.style.left = `${startX}px`;
    node.style.top = `${startY}px`;
    node.style.setProperty("--fly-dx", `${feedX - startX}px`);
    node.style.setProperty("--fly-dy", `${feedY - startY}px`);
    // Positioned, so it is safe to paint. A layout effect runs before the
    // browser paints, so the emoji is never visible at the wrong coordinates.
    node.style.visibility = "visible";
  }, [active, fromX, fromY, onDone]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(timer);
  }, [active, onDone]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Outer: horizontal movement (linear) */}
      <div
        ref={nodeRef}
        className="absolute"
        style={{
          // Hidden until the layout effect has measured and positioned it.
          visibility: "hidden",
          willChange: "transform",
          animation: `flyout-x ${DURATION_MS}ms cubic-bezier(0.25, 0.1, 0.25, 1) forwards`,
        }}
      >
        {/* Inner: vertical movement with arc + scale down */}
        <div
          style={{
            willChange: "transform, opacity",
            animation: `flyout-y ${DURATION_MS}ms cubic-bezier(0.45, 0, 0.85, 0.6) forwards, flyout-fade ${DURATION_MS}ms ease forwards`,
          }}
        >
          <div className="flex items-center justify-center -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[var(--color-bg-elevated)] shadow-lg text-xl">
            {emoji}
          </div>
        </div>
      </div>
    </div>
  );
}
