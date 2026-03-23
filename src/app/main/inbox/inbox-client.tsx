"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { todayDateKey, getBrowserTimezone } from "@/lib/utils/timezone";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MissedHabitNotification = {
  habitId: string;
  title: string;
  emoji: string;
  color: string;
  friendId: string;
  friendName: string;
  friendAvatar: string | null;
  timeWindow: { start?: string; end?: string } | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InboxClient({
  missedHabits,
}: {
  missedHabits: MissedHabitNotification[];
}) {
  const queryClient = useQueryClient();
  const storageKey = `dismissed-inbox-${todayDateKey(getBrowserTimezone())}`;

  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) return new Set();
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    } catch {
      return new Set();
    }
  });

  const dismiss = useCallback((habitId: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(habitId);
      try { sessionStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
      return next;
    });
    // Force the TopBar badge to re-read sessionStorage and update immediately
    queryClient.refetchQueries({ queryKey: ["missed-habits-count"] });
  }, [storageKey, queryClient]);

  const visible = missedHabits.filter((n) => !dismissed.has(n.habitId));

  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header */}
        <h1
          className="font-display font-bold text-[var(--color-text-primary)]"
          style={{ fontSize: "var(--text-2xl)" }}
        >
          Inbox
        </h1>

        {/* Missed habits list */}
        {visible.length > 0 && (
          <div className="space-y-3">
            {visible.map((item) => (
              <div
                key={item.habitId}
                className={cn(
                  "flex items-center gap-3 p-4 rounded-lg shadow-sm",
                  "bg-elevated border-l-[3px] border-l-miss",
                )}
              >
                <Link
                  href={`/main/feed/${item.friendId}`}
                  className={cn(
                    "flex items-center gap-3 flex-1 min-w-0",
                    "hover:opacity-80 transition-opacity",
                  )}
                >
                  <Avatar
                    src={item.friendAvatar}
                    name={item.friendName}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                      {item.friendName}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)] truncate">
                      Hasn&apos;t completed{" "}
                      <span className="font-medium">
                        {item.emoji} {item.title}
                      </span>{" "}
                      today
                    </p>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle
                      className="w-3.5 h-3.5 text-miss"
                    />
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => dismiss(item.habitId)}
                  className="p-1.5 -mr-1 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors flex-shrink-0"
                  aria-label={`Dismiss notification for ${item.title}`}
                >
                  <X className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {visible.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center mx-auto mb-4">
              <Bell className="w-6 h-6 text-[var(--color-text-tertiary)]" />
            </div>
            <h2
              className="font-display font-semibold text-[var(--color-text-primary)] mb-2"
              style={{ fontSize: "var(--text-xl)" }}
            >
              All caught up
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-xs mx-auto">
              When a friend misses a habit, it&apos;ll show up here so you can
              send encouragement.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
