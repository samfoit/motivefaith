"use client";

import { Lock, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface PrivateToggleProps {
  isPrivate: boolean;
  onChange: (isPrivate: boolean) => void;
  /** "dark" sits on the full-screen black camera and recorder overlays. */
  tone?: "sheet" | "dark";
  disabled?: boolean;
  className?: string;
}

/**
 * Whether a check-in's note or media goes to partners or stays in your own
 * history. Both states say what partners get, since they always see the
 * check-in itself: "Only me" read as though they would see nothing at all.
 */
export function PrivateToggle({
  isPrivate,
  onChange,
  tone = "sheet",
  disabled,
  className,
}: PrivateToggleProps) {
  const Icon = isPrivate ? Lock : Users;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isPrivate}
      aria-label="Share check-in only"
      disabled={disabled}
      onClick={() => onChange(!isPrivate)}
      className={cn(
        "inline-flex items-center gap-1.5 min-h-9 rounded-full px-3 text-xs font-medium",
        "border transition-colors disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
        tone === "dark"
          ? isPrivate
            ? "border-white bg-white text-black"
            : "border-white/25 bg-white/10 text-white/80"
          : isPrivate
            ? "border-brand-ink bg-brand-light text-brand-ink"
            : "border-[var(--color-surface-hover)] text-text-secondary hover:bg-surface-hover",
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{isPrivate ? "Check-in only" : "Share all"}</span>
    </button>
  );
}
