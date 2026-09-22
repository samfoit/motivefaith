import React from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "rect" | "text" | "circle";

export interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
  width?: string | number;
  height?: string | number;
  variant?: Variant;
  animate?: boolean;
  // if true it's decorative (hidden from AT), otherwise provide ariaLabel
  decorative?: boolean;
  ariaLabel?: string;
}

const VARIANT_CLASS: Record<Variant, string> = {
  rect: "",
  circle: "motive-skeleton--circle",
  text: "motive-skeleton--text",
};

/**
 * A single shimmer block.
 *
 * The visual language (color, shimmer, duration, radius) lives in
 * `.motive-skeleton` in globals.css so every skeleton in the app shares one
 * definition and one reduced-motion opt-out. Previously each instance carried
 * its own inline `animation`, which meant nothing could be changed centrally.
 *
 * Individual blocks are decorative by default: announce the *screen*, not each
 * block, by wrapping a group in <SkeletonScreen>.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  (
    {
      className,
      style,
      width,
      height,
      variant = "rect",
      animate = true,
      decorative = true,
      ariaLabel,
    },
    ref,
  ) => {
    const computedStyle: React.CSSProperties = {
      width: width ?? (variant === "text" ? "100%" : undefined),
      height: height ?? (variant === "text" ? "1em" : undefined),
      display: variant === "text" ? "block" : "inline-block",
      ...style,
    };

    return (
      <div
        ref={ref}
        role={decorative ? undefined : "status"}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : ariaLabel}
        className={cn(
          "motive-skeleton",
          VARIANT_CLASS[variant],
          !animate && "motive-skeleton--static",
          className,
        )}
        style={computedStyle}
      />
    );
  },
);

Skeleton.displayName = "Skeleton";

export interface SkeletonScreenProps {
  children: React.ReactNode;
  className?: string;
  /** Announced to assistive tech while this screen is up. */
  label?: string;
}

/**
 * Wraps a group of skeletons into one loading *screen*.
 *
 * Three jobs:
 *
 *  1. **Delay-before-show.** `.motive-skeleton-screen` keeps the group at
 *     opacity 0 for `--skeleton-delay` (200ms). Content that resolves inside
 *     that window swaps in without the skeleton ever being painted.
 *  2. **One timeline.** Because the reveal is on the group rather than each
 *     block, everything in a screen appears together instead of each block
 *     starting its own animation as it mounts.
 *  3. **Accessibility.** One polite live region per screen with `aria-busy`,
 *     rather than dozens of individually-announced blocks. The blocks
 *     themselves stay `aria-hidden`.
 */
export function SkeletonScreen({
  children,
  className,
  label = "Loading",
}: SkeletonScreenProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("motive-skeleton-screen", className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export default Skeleton;
