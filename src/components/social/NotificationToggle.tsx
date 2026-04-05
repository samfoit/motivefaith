"use client";

import { Bell, BellOff, Loader2 } from "lucide-react";
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
    description: "Push notifications are not available on this device.",
  },
  "requires-install": {
    label: "Install Required",
    description:
      "Add MotiveFaith to your home screen to enable notifications.",
  },
  denied: {
    label: "Blocked",
    description:
      "Notifications are blocked. Enable them in your browser settings.",
  },
  prompt: {
    label: "Notifications Off",
    description: "Get notified when friends complete habits or need encouragement.",
    actionLabel: "Enable Notifications",
  },
  unsubscribed: {
    label: "Notifications Off",
    description: "You won't receive push notifications.",
    actionLabel: "Turn On",
  },
  subscribed: {
    label: "Notifications On",
    description: "You'll be notified about friend activity and encouragements.",
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
  className?: string;
}

export function NotificationToggle({
  state,
  isLoading,
  onSubscribe,
  onUnsubscribe,
  className,
}: NotificationToggleProps) {
  const config = STATE_CONFIG[state];
  const isActive = state === "subscribed";
  const canToggle = state === "prompt" || state === "unsubscribed" || state === "subscribed";

  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg bg-elevated p-4 shadow-sm",
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
          <Bell className="w-5 h-5 text-brand" />
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

      {canToggle && (
        <Button
          variant={isActive ? "ghost" : "secondary"}
          size="sm"
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
    </div>
  );
}
