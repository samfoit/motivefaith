"use client";

import { useEffect, useCallback } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useMissedHabitCount } from "@/lib/hooks/useMissedHabits";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";

export function TopBar() {
  const userId = useAuthUserId();
  const queryClient = useQueryClient();
  const { data: unreadCount = 0 } = useMissedHabitCount(userId);

  // Invalidate missed-habits count on tab focus / visibility change
  // instead of maintaining a separate realtime channel.
  // The feed page's realtime channel already listens for completions;
  // this covers the case where the user returns to the app.
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["missed-habits-count"] });
  }, [queryClient]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [invalidate]);

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between px-4 h-14 bg-[var(--color-bg-elevated)] border-b border-[var(--color-bg-secondary)]">
      <Link
        href="/main/dashboard"
        className="font-display text-lg font-bold text-[var(--color-text-primary)]"
      >
        MotiveFaith
      </Link>

      <Link
        href="/main/inbox"
        className="relative p-2 rounded-full transition-colors hover:bg-[var(--color-surface-hover)]"
        aria-label={unreadCount > 0 ? `Inbox, ${unreadCount} unread` : "Inbox"}
      >
        <Bell className="w-5 h-5 text-[var(--color-text-secondary)]" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-miss rounded-full"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>
    </header>
  );
}
