import React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils/cn";

type Size = "sm" | "md" | "lg";

export interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  title?: string | React.ReactNode;
  description?: string | React.ReactNode;
  size?: Size;
  showHandle?: boolean;
  closeLabel?: string;
  className?: string;
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: "max-h-[40vh]",
  md: "max-h-[60vh]",
  lg: "max-h-[90vh]",
};

export const Sheet: React.FC<SheetProps> = ({
  open,
  onOpenChange,
  children,
  title,
  description,
  size = "md",
  showHandle = true,
  closeLabel = "Close",
  className,
}) => {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const startYRef = React.useRef<number | null>(null);
  const lastTranslateRef = React.useRef(0);
  const draggingRef = React.useRef(false);

  // apply translateY directly for drag feedback
  const setTranslate = (y: number) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transform = `translateY(${y}px)`;
  };

  const handlePointerDown: React.PointerEventHandler = (e) => {
    // only left button / touch
    if (e.pointerType === "mouse" && e.button !== 0) return;
    draggingRef.current = true;
    startYRef.current = e.clientY;
    lastTranslateRef.current = 0;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // disable transition while dragging
    const el = contentRef.current;
    if (el) el.style.transition = "none";
  };

  const handlePointerMove: React.PointerEventHandler = (e) => {
    if (!draggingRef.current || startYRef.current == null) return;
    const delta = Math.max(0, e.clientY - startYRef.current);
    lastTranslateRef.current = delta;
    setTranslate(delta);
  };

  const handlePointerUpOrCancel = (closeIfThreshold = true) => {
    draggingRef.current = false;
    startYRef.current = null;
    const el = contentRef.current;
    if (!el) return;
    // restore transition with a spring-like easing
    el.style.transition = "transform 420ms cubic-bezier(.22,.9,.35,1.2)";
    const moved = lastTranslateRef.current;
    lastTranslateRef.current = 0;
    // threshold: 120px or more than 25% of height
    const threshold = Math.min(160, (el.offsetHeight || 400) * 0.25);
    if (closeIfThreshold && moved >= threshold) {
      // animate out then call onOpenChange(false)
      el.style.transform = `translateY(100%)`;
      // wait for animation then signal close
      window.setTimeout(() => onOpenChange?.(false), 300);
    } else {
      // snap back
      el.style.transform = `translateY(0)`;
    }
  };

  React.useEffect(() => {
    // cleanup inline styles when unmounted/closed
    if (!open && contentRef.current) {
      contentRef.current.style.transition = "";
      contentRef.current.style.transform = "";
    }
  }, [open]);

  // Push the sheet above the on-screen keyboard using the Visual Viewport API.
  // On iOS Safari, `position: fixed; bottom: 0` doesn't account for the
  // keyboard, so the sheet content gets hidden behind it.
  React.useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const adjust = () => {
      const el = contentRef.current;
      if (!el) return;
      const kbHeight = window.innerHeight - (vv.height + vv.offsetTop);
      el.style.bottom = kbHeight > 0 ? `${kbHeight}px` : "0px";
    };

    vv.addEventListener("resize", adjust);
    vv.addEventListener("scroll", adjust);
    adjust();

    return () => {
      vv.removeEventListener("resize", adjust);
      vv.removeEventListener("scroll", adjust);
      const el = contentRef.current;
      if (el) el.style.bottom = "";
    };
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity",
            open ? "opacity-100" : "opacity-0",
          )}
        />

        <RadixDialog.Content
          ref={contentRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => handlePointerUpOrCancel(true)}
          onPointerCancel={() => handlePointerUpOrCancel(false)}
          className={cn(
            // base
            "fixed left-0 right-0 bottom-0 z-50 mx-auto w-full max-w-2xl rounded-t-lg shadow-lg bg-elevated p-4",
            // ensure smooth enter/exit & spring-like easing when not dragging
            "transform transition-transform duration-420 ease-[cubic-bezier(.22,.9,.35,1.2)]",
            // start hidden offscreen when closed - Radix mounts based on open, but class keeps consistent look
            !open && "translate-y-full",
            SIZE_CLASSES[size],
            "overflow-auto",
            className,
          )}
          style={{ touchAction: "pan-y" }}
        >
          <div className="mx-auto max-w-3xl">
            {showHandle && (
              <div className="flex justify-center mb-3 -mt-2">
                <div
                  className="h-1.5 w-12 rounded-full bg-text-tertiary/40"
                  aria-hidden
                  onPointerDown={handlePointerDown}
                />
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <div className="flex-1 min-w-0">
                <RadixDialog.Title
                  className={cn(
                    "font-display text-lg font-semibold text-text-primary",
                    !title && "sr-only",
                  )}
                >
                  {title || "Dialog"}
                </RadixDialog.Title>
                {description && (
                  <RadixDialog.Description className="text-sm text-text-secondary mt-1">
                    {description}
                  </RadixDialog.Description>
                )}
              </div>

              <RadixDialog.Close asChild>
                <button
                  aria-label={closeLabel}
                  className="ml-3 inline-flex items-center justify-center rounded-md p-2 text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 8.586L15.95 2.636a1 1 0 111.414 1.414L11.414 10l5.95 5.95a1 1 0 01-1.414 1.414L10 11.414l-5.95 5.95a1 1 0 01-1.414-1.414L8.586 10 2.636 4.05A1 1 0 014.05 2.636L10 8.586z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </RadixDialog.Close>
            </div>

            <div>{children}</div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};

export default Sheet;
