"use client";

import { useEffect, useState } from "react";

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
 */
export function CompletionFlyout({ active, emoji, from, onDone }: CompletionFlyoutProps) {
  const [style, setStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    if (!active) {
      setStyle(null);
      return;
    }

    // Find the Feed icon in the bottom nav
    const feedEl = document.querySelector<HTMLElement>("[data-nav='feed']");
    if (!feedEl) {
      // No feed icon visible — skip animation
      onDone();
      return;
    }

    const feedRect = feedEl.getBoundingClientRect();
    const feedX = feedRect.left + feedRect.width / 2;
    const feedY = feedRect.top + feedRect.height / 2;

    // Start from the provided origin (e.g. checkmark button) or center of viewport
    const startX = from?.x ?? window.innerWidth / 2;
    const startY = from?.y ?? window.innerHeight * 0.5;

    const dx = feedX - startX;
    const dy = feedY - startY;

    setStyle({
      left: startX,
      top: startY,
      "--fly-dx": `${dx}px`,
      "--fly-dy": `${dy}px`,
    } as React.CSSProperties);

    const timer = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(timer);
  }, [active, onDone]);

  if (!active || !style) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Outer: horizontal movement (linear) */}
      <div
        className="absolute"
        style={{
          ...style,
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
