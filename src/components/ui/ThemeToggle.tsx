"use client";

import React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useThemeStore,
  type ThemePreference,
} from "@/lib/stores/theme-store";

const OPTIONS: { value: ThemePreference; icon: React.ElementType; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [mounted, setMounted] = React.useState(false);
  const preference = useThemeStore((s) => s.preference);
  const setTheme = useThemeStore((s) => s.setTheme);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Use server default until mounted to avoid hydration mismatch
  const activePreference = mounted ? preference : "system";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex rounded-lg bg-[var(--color-bg-secondary)] p-1 gap-1",
        className,
      )}
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const isActive = activePreference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
              "duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
              isActive
                ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
