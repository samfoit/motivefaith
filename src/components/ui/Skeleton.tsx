import React from "react";

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

const shimmerStyle: React.CSSProperties = {
  backgroundColor: "var(--color-skeleton)",
  backgroundImage:
    "linear-gradient(90deg, var(--color-skeleton) 0%, var(--color-skeleton-highlight) 40%, var(--color-skeleton) 100%)",
  backgroundSize: "200% 100%",
  backgroundRepeat: "no-repeat",
  animation: "motive-shimmer 1.2s linear infinite",
};

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
      ...shimmerStyle,
      ...(animate ? undefined : { animation: "none" }),
      width: width ?? (variant === "text" ? "100%" : undefined),
      height: height ?? (variant === "text" ? "1em" : undefined),
      borderRadius:
        variant === "circle" ? "50%" : variant === "text" ? 4 : undefined,
      display: variant === "text" ? "block" : "inline-block",
      ...style,
    };

    return (
      <div
        ref={ref}
        role={decorative ? undefined : "status"}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : ariaLabel}
        className={className}
        style={computedStyle}
      />
    );
  },
);

Skeleton.displayName = "Skeleton";

export default Skeleton;
