"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Cursor travel before a press on an item becomes a pull on the row. */
const DRAG_THRESHOLD = 5;

/** Width of the fade on an edge that has more to scroll to. */
const FADE = 28;

/**
 * Classes for the row element: no visible scrollbar (the fade signals the
 * overflow), and a grab cursor, the only hint that the strip can be pulled.
 */
export const SCROLL_ROW_CLASS =
  "flex overflow-x-auto select-none cursor-grab active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/**
 * A single row of tappable items that is wider than a phone and scrolls
 * sideways, rather than shrinking the targets or wrapping into a grid. Shared
 * by the color and icon pickers so the two strips behave the same.
 *
 * A fade on the overflowing edge is what tells you there is more to see;
 * without it the last items are simply undiscoverable. The fade is a mask on
 * the row itself rather than a gradient overlay, so it works on the plain page
 * background of the wizard and the elevated background of a sheet alike.
 *
 * Spread `rowProps` on the scrolling element and give it SCROLL_ROW_CLASS.
 */
export function useScrollRow<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflow({
      start: el.scrollLeft > 1,
      // Sub-pixel widths mean scrollLeft never quite reaches max.
      end: max > 1 && el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // The row is often inside a sheet that animates in, so its width settles
    // a frame or two after mount.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // A horizontal strip with no visible scrollbar is unreachable with a mouse:
  // the wheel scrolls the page straight past it. Translate a vertical wheel
  // into horizontal travel, but only while the row can still move that way —
  // at either end the page has to go back to scrolling normally, or the
  // picker becomes a trap the page cannot be scrolled through.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // A trackpad's sideways gesture already does the right thing.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return;
      const atStart = e.deltaY < 0 && el.scrollLeft <= 0;
      const atEnd = e.deltaY > 0 && el.scrollLeft >= max - 1;
      if (atStart || atEnd) return;
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
      measure();
    };

    // Must be non-passive: a passive listener cannot preventDefault, and
    // React's own onWheel is registered passively.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [measure]);

  // Grab and pull the row, the way the same strip is swiped on a phone.
  // Touch is left alone deliberately: the browser's own momentum and
  // rubber-banding are better than anything reimplemented here, and driving
  // scrollLeft by hand would fight them. This is the mouse's version of that
  // gesture.
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    startScroll: 0,
  });
  // A drag that ends on an item must not also pick it.
  const suppressClickRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    dragRef.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
    };
    suppressClickRef.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = ref.current;
    if (!drag.active || !el || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved) {
      // Below the threshold this is still a click on an item, not a drag.
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.moved = true;
      suppressClickRef.current = true;
      // Capture so the pull continues if the cursor leaves the strip.
      el.setPointerCapture(e.pointerId);
    }
    // onScroll runs measure(), so the edge fades keep up on their own.
    el.scrollLeft = drag.startScroll - dx;
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    drag.active = false;
    const el = ref.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }, []);

  // Capture phase: swallow the click that ends a drag before it reaches the
  // item underneath — including a native picker, which it would otherwise
  // open.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Fade only the edges that actually overflow, so a short row stays crisp.
  const stops: string[] = [];
  stops.push(overflow.start ? `transparent 0, black ${FADE}px` : "black 0");
  stops.push(
    overflow.end
      ? `black calc(100% - ${FADE}px), transparent 100%`
      : "black 100%",
  );
  const mask = `linear-gradient(to right, ${stops.join(", ")})`;

  return {
    ref,
    rowProps: {
      ref,
      onScroll: measure,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onClickCapture,
      style: { maskImage: mask, WebkitMaskImage: mask },
    },
  };
}
