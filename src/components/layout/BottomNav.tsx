"use client";

import { useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Home, Activity, Camera, Users, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useQuickCaptureStore } from "@/lib/stores/quick-capture-store";
import { useHasUnreadFeeds } from "@/lib/hooks/useHasUnreadFeeds";
import { useHasPendingRequests } from "@/lib/hooks/useHasPendingRequests";

const NAV_ITEMS = [
  { href: "/main/dashboard", label: "Home", icon: Home },
  { href: "/main/feed", label: "Feed", icon: Activity },
  { href: "", label: "Capture", icon: Camera, isAction: true },
  { href: "/main/friends", label: "Friends", icon: Users },
  { href: "/main/profile", label: "Profile", icon: User },
] as const;

interface BottomNavProps {
  userId?: string;
}

export function BottomNav({ userId }: BottomNavProps) {
  const pathname = usePathname();
  const openCapture = useQuickCaptureStore((s) => s.open);
  const queryClient = useQueryClient();
  const { data: hasUnread = false } = useHasUnreadFeeds(userId ?? null);
  const { data: hasPendingRequests = false } = useHasPendingRequests(userId ?? null);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["unread-feeds"] });
    queryClient.invalidateQueries({ queryKey: ["pending-requests"] });
  }, [queryClient]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [invalidate]);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-[var(--color-bg-elevated)] border-t border-[var(--color-bg-secondary)] pb-[env(safe-area-inset-bottom)]"
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon, ...rest }) => {
          const isAction = "isAction" in rest && rest.isAction;
          const isActive = pathname.startsWith(href);

          if (isAction) {
            return (
              <button
                key={label}
                type="button"
                onClick={openCapture}
                aria-label={label}
                className="flex items-center justify-center w-12 h-12 -mt-4 rounded-full bg-[var(--color-brand)] text-white shadow-md transition-transform duration-200 ease-[cubic-bezier(.34,1.56,.64,1)] hover:scale-110 active:scale-95"
              >
                <Icon className="w-6 h-6" strokeWidth={2.5} />
              </button>
            );
          }

          const showBadge =
            (label === "Feed" && hasUnread) ||
            (label === "Friends" && hasPendingRequests);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 min-w-[64px] py-1 transition-colors",
                isActive
                  ? "text-[var(--color-brand)]"
                  : "text-[var(--color-text-tertiary)]",
              )}
              aria-current={isActive ? "page" : undefined}
              aria-label={showBadge ? `${label}, new activity` : label}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {showBadge && (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-brand"
                  />
                )}
              </span>
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
