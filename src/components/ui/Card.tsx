import React from "react";
import { cn } from "@/lib/utils/cn";

type AccentKey =
  | "default"
  | "health"
  | "productivity"
  | "learning"
  | "social"
  | "finance";
type Props = React.HTMLAttributes<HTMLDivElement> & {
  hoverLift?: boolean;
  colorAccent?: AccentKey | string | null;
};

const ACCENT_CLASSES: Record<AccentKey, string> = {
  default: "border-l-[3px] border-gray-200",
  health: "border-l-[3px] border-emerald-400",
  productivity: "border-l-[3px] border-indigo-400",
  learning: "border-l-[3px] border-amber-400",
  social: "border-l-[3px] border-pink-400",
  finance: "border-l-[3px] border-sky-400",
};

export const Container = React.forwardRef<HTMLDivElement, Props>(
  (
    { children, className, hoverLift = false, colorAccent = null, ...props },
    ref,
  ) => {
    const accentClass = colorAccent
      ? (ACCENT_CLASSES[colorAccent as AccentKey] ??
        `border-l-[3px] ${colorAccent}`)
      : "";

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg shadow-sm bg-elevated p-4",
          // optional hover lift with bounce-like easing
          hoverLift &&
            "transition-transform duration-200 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-1 hover:shadow-md",
          // ensure spacing from left accent border when present
          accentClass && "pl-4",
          accentClass,
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Container.displayName = "Container";

export default Container;
