import React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * What the pill means, in the app's own color vocabulary (DESIGN.md, Colors):
 * neutral for plain labels, brand for "needs you" status, and the three
 * meaning hues. Text stays in the hour's ink or Lamp Ink so it holds 4.5:1
 * at every hour; the hue lives in the wash and the dot, not in the letters.
 */
type Tone = "neutral" | "brand" | "rain" | "encourage" | "miss";
type Size = "sm" | "md";
type Status = "positive" | "neutral" | "negative" | "warning";

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: Size;
  count?: number | null;
  status?: Status | null;
  showStatusDot?: boolean;
  /** A hairline ring on a clear ground, for pills sitting on a tinted surface. */
  outline?: boolean;
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-hover text-text-secondary",
  brand: "bg-brand-light text-brand-ink",
  rain: "bg-rain/15 text-text-primary",
  encourage: "bg-encourage/15 text-text-primary",
  miss: "bg-miss/15 text-text-primary",
};

const TONE_OUTLINE: Record<Tone, string> = {
  neutral: "bg-transparent text-text-secondary ring-1 ring-border",
  brand: "bg-transparent text-brand-ink ring-1 ring-brand-ink/30",
  rain: "bg-transparent text-text-primary ring-1 ring-rain/40",
  encourage: "bg-transparent text-text-primary ring-1 ring-encourage/40",
  miss: "bg-transparent text-text-primary ring-1 ring-miss/40",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1 text-sm",
};

/** Done is the lamp lit; trouble is red; a caution is the flame. */
const STATUS_DOT: Record<Status, string> = {
  positive: "bg-success",
  neutral: "bg-text-tertiary",
  negative: "bg-miss",
  warning: "bg-streak",
};

export const Pill = React.forwardRef<HTMLSpanElement, PillProps>(
  (
    {
      tone = "neutral",
      size = "md",
      count = null,
      status = null,
      showStatusDot = false,
      outline = false,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const toneClass = outline ? TONE_OUTLINE[tone] : TONE_CLASSES[tone];

    return (
      <span
        ref={ref}
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-1.5 select-none rounded-full font-medium",
          SIZE_CLASSES[size],
          toneClass,
          className,
        )}
        {...props}
      >
        {showStatusDot && status && (
          <span
            aria-hidden
            className={cn(
              "inline-block shrink-0 rounded-full",
              size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5",
              STATUS_DOT[status],
            )}
          />
        )}

        <span className="truncate">{children}</span>

        {typeof count === "number" && (
          <span
            className={cn(
              "ml-0.5 inline-flex items-center justify-center rounded-full font-semibold tabular-nums",
              "px-1.5 py-0.5 text-xs",
              outline ? "bg-surface-hover text-text-primary" : "bg-elevated text-text-primary",
            )}
            aria-label={`count ${count}`}
          >
            {count}
          </span>
        )}
      </span>
    );
  },
);

Pill.displayName = "Pill";

export default Pill;
