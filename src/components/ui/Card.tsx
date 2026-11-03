import React from "react";
import { cn } from "@/lib/utils/cn";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  hoverLift?: boolean;
  /**
   * A habit color (hex, as stored on habits.color). Tints the card the way a
   * habit card is tinted: a 1px border in the color and a faint wash of it
   * (.habit-tint in globals.css). Null or omitted leaves the plain hairline.
   */
  tint?: string | null;
};

/**
 * A card on the Lamplight surfaces: the card token for the hour, a hairline
 * border, and the faint lift every card in the app shares (DESIGN.md,
 * Cards / Containers).
 */
export const Container = React.forwardRef<HTMLDivElement, Props>(
  ({ children, className, hoverLift = false, tint = null, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg border border-border shadow-sm bg-elevated p-4",
          tint && "habit-tint",
          hoverLift &&
            "transition-transform duration-200 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-1 hover:shadow-md",
          className,
        )}
        style={
          tint
            ? ({ ["--habit-color" as string]: tint, ...style } as React.CSSProperties)
            : style
        }
        {...props}
      >
        {children}
      </div>
    );
  },
);

Container.displayName = "Container";

export default Container;
