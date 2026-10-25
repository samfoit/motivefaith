"use client";

import { useEffect } from "react";
import { Check, Ban } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { HABIT_COLORS, isSameColor, hasNoColor } from "@/lib/constants/colors";
import { SCROLL_ROW_CLASS, useScrollRow } from "@/lib/hooks/useScrollRow";

interface ColorPickerProps {
  /** null is "no color" — the default, and the first swatch in the row. */
  value: string | null;
  onChange: (color: string | null) => void;
  /** Rendered above the row; pass "" where the section heading already says it. */
  label?: string;
  className?: string;
}

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
 * into a grid, with a fade on the edge that has more (see useScrollRow).
 */
export function ColorPicker({
  value,
  onChange,
  label = "Color",
  className,
}: ColorPickerProps) {
  const { ref: rowRef, rowProps } = useScrollRow();

  const none = hasNoColor(value);
  const isPreset = !none && HABIT_COLORS.some((c) => isSameColor(value, c.value));
  // Only a real hex that is not one of the presets counts as custom — without
  // the `none` guard an uncolored habit lights up the custom swatch instead.
  const custom = !none && !isPreset;

  // Reopening with a color already chosen should show it, not the start.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    // No color is the default and the first swatch, so there is nothing to
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

  const swatch = cn(
    "relative shrink-0 w-11 h-11 rounded-full transition-transform",
    "flex items-center justify-center active:scale-90",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "focus-visible:ring-brand-ink focus-visible:ring-offset-[var(--color-bg-elevated)]",
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
        {...rowProps}
        role="group"
        aria-labelledby={label ? "habit-color-label" : undefined}
        aria-label={label ? undefined : "Color"}
        className={cn(SCROLL_ROW_CLASS, "gap-2 py-1")}
      >
        {/* No color — the default. A plain card, not a pale one, so it
            reads as "leave this alone" rather than as another pale swatch.
            The slash is what separates it from a light gray pick. */}
        <button
          type="button"
          aria-pressed={none}
          aria-label="No color"
          onClick={() => onChange(null)}
          className={cn(
            swatch,
            "bg-elevated border border-border text-text-tertiary",
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
