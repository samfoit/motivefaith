"use client";

import { Bell, BellOff, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import type { PushState } from "@/lib/hooks/usePushSubscription";

// ---------------------------------------------------------------------------
// State display config
// ---------------------------------------------------------------------------

const STATE_CONFIG: Record<
  PushState,
  { label: string; description: string; actionLabel?: string }
> = {
  unsupported: {
    label: "Not Supported",
    description: "This device can't receive notifications.",
  },
  "requires-install": {
    label: "Notifications Off",
    description: "Download the app to turn on notifications.",
    actionLabel: "Download",
  },
  denied: {
    label: "Blocked",
    description: "Turn them back on in browser settings.",
  },
  prompt: {
    label: "Notifications Off",
    description: "Get friend activity and encouragements.",
    actionLabel: "Turn On",
  },
  unsubscribed: {
    label: "Notifications Off",
    description: "Push is off on this device.",
    actionLabel: "Turn On",
  },
  subscribed: {
    label: "Notifications On",
    description: "Reminders, friend activity, quiet hours.",
    actionLabel: "Turn Off",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NotificationToggleProps {
  state: PushState;
  isLoading: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  /** When set, the subscribed state drills into settings instead of offering Turn Off. */
  onOpenSettings?: () => void;
  /** Shows the install directions, for devices that only get push once installed. */
  onInstall?: () => void;
  className?: string;
}

export function NotificationToggle({
  state,
  isLoading,
  onSubscribe,
  onUnsubscribe,
  onOpenSettings,
  onInstall,
  className,
}: NotificationToggleProps) {
  const config = STATE_CONFIG[state];
  const isActive = state === "subscribed";
  const canToggle = state === "prompt" || state === "unsubscribed" || state === "subscribed";
  const canInstall = state === "requires-install" && !!onInstall;
  const drillIn = isActive && !!onOpenSettings;
  const Root = drillIn ? "button" : "div";

  return (
    <Root
      {...(drillIn && { type: "button" as const, onClick: onOpenSettings })}
      className={cn(
        "w-full flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm text-left",
        drillIn && "transition-opacity active:opacity-70",
        className,
      )}
    >
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
          isActive
            ? "bg-[color-mix(in_srgb,var(--color-brand)_15%,transparent)]"
            : "bg-[var(--color-bg-secondary)]",
        )}
      >
        {isActive ? (
          <Bell className="w-5 h-5 text-brand-ink" />
        ) : (
          <BellOff className="w-5 h-5 text-[var(--color-text-tertiary)]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">
          {config.label}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
          {config.description}
        </p>
      </div>

      {drillIn ? (
        <ChevronRight className="w-4 h-4 shrink-0 text-[var(--color-text-tertiary)]" />
      ) : canInstall ? (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={onInstall}>
          <span>{config.actionLabel}</span>
        </Button>
      ) : canToggle && (
        <Button
          variant={isActive ? "ghost" : "secondary"}
          size="sm"
          className="shrink-0"
          onClick={isActive ? onUnsubscribe : onSubscribe}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <span>{config.actionLabel}</span>
          )}
        </Button>
      )}
    </Root>
  );
}
