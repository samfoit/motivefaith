"use client";

import { useId } from "react";
import { Globe, Lock, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { HabitVisibility } from "@/lib/types/partners";

const OPTIONS: {
  value: HabitVisibility;
  icon: React.ElementType;
  label: string;
  description: string;
}[] = [
  {
    value: "private",
    icon: Lock,
    label: "Private",
    description:
      "Nobody can find this. Invite partners yourself and only they can see it.",
  },
  {
    value: "public",
    icon: Globe,
    label: "Public",
    description:
      "Friends can see this on your profile and ask to follow it.",
  },
];

interface VisibilityPickerProps {
  value: HabitVisibility;
  onChange: (value: HabitVisibility) => void;
  /**
   * "cards" spells out both choices. "segmented" is the compact form for the
   * new-habit wizard: a two-way switch, explaining only the current choice.
   */
  variant?: "cards" | "segmented";
  className?: string;
}

/**
 * Where a habit can be *found* — not who can see how it is going.
 *
 * The two are worth keeping apart in the copy, because people reasonably read
 * "public" as "everyone follows my streak". They do not: a public habit tells
 * friends it exists and what it is called, so they have something to ask
 * about. The streak arrives with the partnership, whichever way round the
 * partnership was started.
 */
export function VisibilityPicker({
  value,
  onChange,
  variant = "cards",
  className,
}: VisibilityPickerProps) {
  const descriptionId = useId();

  if (variant === "segmented") {
    const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
    return (
      <div className={className}>
        <div
          role="radiogroup"
          aria-label="Who can find this habit"
          aria-describedby={descriptionId}
          // The track is the hour's own track color: on the bare page the
          // tile color is the page itself, and the control would vanish.
          className="flex gap-1 rounded-lg bg-surface-hover p-1"
        >
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onChange(option.value)}
                className={cn(
                  "flex-1 min-h-10 flex items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium",
                  "transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
                  isSelected
                    ? "bg-brand text-on-brand shadow-sm"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>
        <p id={descriptionId} className="mt-2 text-xs text-text-secondary text-pretty">
          {current.description}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)} role="radiogroup" aria-label="Who can find this habit">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              "w-full flex items-start gap-3 p-4 rounded-lg text-left transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
              isSelected
                ? "bg-brand-light ring-2 ring-brand-ink"
                : "bg-elevated ring-1 ring-border hover:bg-[var(--color-surface-hover)]",
            )}
          >
            <div
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
                isSelected
                  ? "bg-brand text-on-brand"
                  : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]",
              )}
            >
              <Icon className="w-4 h-4" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {option.label}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {option.description}
              </p>
            </div>

            <div
              className={cn(
                "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors",
                isSelected ? "bg-brand border-brand-ink" : "border-text-tertiary",
              )}
            >
              {isSelected && <Check className="w-3 h-3 text-on-brand" strokeWidth={3} />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
