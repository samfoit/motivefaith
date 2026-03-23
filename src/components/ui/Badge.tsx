import React from "react";
import { cn } from "@/lib/utils/cn";

type Variant =
  | "default"
  | "health"
  | "productivity"
  | "learning"
  | "social"
  | "finance";
type Size = "sm" | "md";
type Status = "positive" | "neutral" | "negative" | "warning";

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  size?: Size;
  count?: number | null;
  status?: Status | null;
  showStatusDot?: boolean;
  /**
   * If true, renders a subtle outline instead of solid background (useful for pills on colored surfaces)
   */
  outline?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  default: "bg-gray-100 text-gray-800",
  health: "bg-emerald-100 text-emerald-800",
  productivity: "bg-indigo-100 text-indigo-800",
  learning: "bg-amber-100 text-amber-800",
  social: "bg-pink-100 text-pink-800",
  finance: "bg-sky-100 text-sky-800",
};

const VARIANT_OUTLINE: Record<Variant, string> = {
  default: "bg-transparent text-gray-800 ring-1 ring-gray-200",
  health: "bg-transparent text-emerald-700 ring-1 ring-emerald-100",
  productivity: "bg-transparent text-indigo-700 ring-1 ring-indigo-100",
  learning: "bg-transparent text-amber-700 ring-1 ring-amber-100",
  social: "bg-transparent text-pink-700 ring-1 ring-pink-100",
  finance: "bg-transparent text-sky-700 ring-1 ring-sky-100",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1 text-sm",
};

const STATUS_DOT: Record<Status, string> = {
  positive: "bg-emerald-500",
  neutral: "bg-gray-400",
  negative: "bg-rose-500",
  warning: "bg-amber-500",
};

export const Pill = React.forwardRef<HTMLSpanElement, PillProps>(
  (
    {
      variant = "default",
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
    const variantClass = outline
      ? VARIANT_OUTLINE[variant]
      : VARIANT_CLASSES[variant];

    return (
      <span
        ref={ref}
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center select-none rounded-full font-medium",
          SIZE_CLASSES[size],
          variantClass,
          className,
        )}
        {...props}
      >
        {showStatusDot && status && (
          <span
            aria-hidden
            className={cn(
              "inline-block flex-shrink-0 rounded-full",
              size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3",
              STATUS_DOT[status],
            )}
          />
        )}

        <span className="truncate">{children}</span>

        {typeof count === "number" && (
          <span
            className={cn(
              "ml-2 inline-flex items-center justify-center rounded-full font-semibold",
              size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
              outline ? "bg-white/5" : "bg-white text-gray-800",
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
