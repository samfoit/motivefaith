"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Ban } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { HABIT_COLORS, isSameColor, hasNoColor } from "@/lib/constants/colors";

interface ColorPickerProps {
  /** null is "no colour" — the default, and the first swatch in the row. */
  value: string | null;
  onChange: (color: string | null) => void;
  /** Rendered above the row; pass "" where the section heading already says it. */
  label?: string;
  className?: string;
}

/** Cursor travel before a press on a swatch becomes a pull on the row. */
const DRAG_THRESHOLD = 5;

/** The swatch the check mark is drawn on top of needs a light or dark tick. */
function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  // Rec. 601 luma — good enough to decide tick contrast.
  return (r * 299 + g * 587 + b * 114) / 1000 > 165;
}

/**
 * A single row of color swatches, with a custom picker at the end.
 *
 * Color is purely decorative — there is no category behind it — so the
 * control is deliberately flat: no grouping, no names on screen, just the
 * swatches.
 *
 * The palette is wider than a phone (11 swatches at a 44px touch target need
 * 564px), so the row scrolls rather than shrinking the targets or wrapping
 * into a grid. A fade on the overflowing edge is what tells you there is more
 * to see; without it the last colors are simply undiscoverable. The fade is a
 * mask on the row itself rather than a gradient overlay, so it works on the
 * plain page background of the wizard and the elevated background of a sheet
 * alike.
 */
export function ColorPicker({
  value,
  onChange,
  label = "Color",
  className,
}: ColorPickerProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const none = hasNoColor(value);
  const isPreset = !none && HABIT_COLORS.some((c) => isSameColor(value, c.value));
  // Only a real hex that is not one of the presets counts as custom — without
  // the `none` guard an uncoloured habit lights up the custom swatch instead.
  const custom = !none && !isPreset;

  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflow({
      start: el.scrollLeft > 1,
      // Sub-pixel widths mean scrollLeft never quite reaches max.
      end: max > 1 && el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    measure();
    // The row is inside a sheet that animates in, so its width settles a
    // frame or two after mount.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // Reopening with a color already chosen should show it, not the start.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    // No colour is the default and the first swatch, so there is nothing to
    // scroll to — and scrolling anyway would hide it, along with the start of
    // the palette, behind the right-hand end of the row.
    if (hasNoColor(value)) return;
    // Children are [none, ...presets, custom].
    const index = HABIT_COLORS.findIndex((c) => isSameColor(value, c.value));
    const target =
      index >= 0 ? el.children[index + 1] : el.children[el.children.length - 1];
    (target as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
    // Intentionally on mount only — scrolling on every pick fights the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A horizontal strip with no visible scrollbar is unreachable with a mouse:
  // the wheel scrolls the page straight past it. Translate a vertical wheel
  // into horizontal travel, but only while the row can still move that way —
  // at either end the page has to go back to scrolling normally, or the
  // picker becomes a trap the page cannot be scrolled through.
  useEffect(() => {
    const el = rowRef.current;
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
  // A drag that ends on a swatch must not also pick it.
  const suppressClickRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = rowRef.current;
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

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = rowRef.current;
    if (!drag.active || !el || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved) {
      // Below the threshold this is still a click on a swatch, not a drag.
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
    const el = rowRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }, []);

  // Capture phase: swallow the click that ends a drag before it reaches the
  // swatch underneath — including the custom slot, where it would otherwise
  // open the OS colour picker.
  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Fade only the edges that actually overflow, so a short row stays crisp.
  const fade = 28;
  const stops: string[] = [];
  stops.push(overflow.start ? `transparent 0, black ${fade}px` : "black 0");
  stops.push(
    overflow.end
      ? `black calc(100% - ${fade}px), transparent 100%`
      : "black 100%",
  );
  const mask = `linear-gradient(to right, ${stops.join(", ")})`;

  const swatch = cn(
    "relative shrink-0 w-11 h-11 rounded-full transition-transform",
    "flex items-center justify-center active:scale-90",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "focus-visible:ring-brand focus-visible:ring-offset-[var(--color-bg-elevated)]",
  );

  return (
    <div className={className}>
      {label && (
        <p
          id="habit-color-label"
          className="text-xs font-medium text-text-secondary mb-2"
        >
          {label}
        </p>
      )}

      <div
        ref={rowRef}
        onScroll={measure}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={handleClickCapture}
        role="group"
        aria-labelledby={label ? "habit-color-label" : undefined}
        aria-label={label ? undefined : "Color"}
        className={cn(
          "flex gap-2 overflow-x-auto py-1 select-none",
          // The cursor is the only hint that the strip can be pulled.
          "cursor-grab active:cursor-grabbing",
          // Hide the scrollbar — the fade already signals the overflow.
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        {/* No colour — the default. A plain card, not a pale one, so it
            reads as "leave this alone" rather than as another pale swatch.
            The slash is what separates it from a light grey pick. */}
        <button
          type="button"
          aria-pressed={none}
          aria-label="No color"
          onClick={() => onChange(null)}
          className={cn(
            swatch,
            "bg-bg-secondary border border-surface-hover text-text-tertiary",
          )}
        >
          {none ? (
            <Check className="w-5 h-5 text-text-secondary" strokeWidth={3} />
          ) : (
            <Ban className="w-5 h-5" strokeWidth={2} />
          )}
        </button>

        {HABIT_COLORS.map((color) => {
          const selected = isSameColor(value, color.value);
          return (
            <button
              key={color.value}
              type="button"
              aria-pressed={selected}
              aria-label={color.label}
              onClick={() => onChange(color.value)}
              className={swatch}
              style={{ backgroundColor: color.value }}
            >
              {selected && (
                <Check
                  className={cn(
                    "w-5 h-5",
                    isLight(color.value) ? "text-black/70" : "text-white",
                  )}
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}

        {/* Custom color — the native picker, dressed as one more swatch.
            The input itself is the hit target (an overlay div would stop the
            OS picker opening on iOS), so it is stretched over the circle at
            zero opacity. */}
        <label
          className={cn(swatch, "cursor-pointer overflow-hidden")}
          style={
            custom && value
              ? { backgroundColor: value }
              : {
                // A color wheel reads as "anything you like" better than a
                // single swatch can.
                backgroundImage:
                  "conic-gradient(#EF4444, #F59E0B, #22C55E, #14B8A6, #3B82F6, #8B5CF6, #EC4899, #EF4444)",
              }
          }
        >
          <input
            type="color"
            value={custom && value ? value : "#6366F1"}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Custom color"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          {custom && value ? (
            <Check
              className={cn(
                "w-5 h-5 pointer-events-none",
                isLight(value) ? "text-black/70" : "text-white",
              )}
              strokeWidth={3}
            />
          ) : (
            // A hole in the wheel keeps it distinct from a plain swatch.
            <span
              aria-hidden
              className="pointer-events-none w-4 h-4 rounded-full bg-[var(--color-bg-elevated)]"
            />
          )}
        </label>
      </div>
    </div>
  );
}
