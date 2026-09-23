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
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";

const NAV_ITEMS = [
  { href: "/main/dashboard", label: "Home", icon: Home },
  { href: "/main/feed", label: "Feed", icon: Activity },
  { href: "", label: "Capture", icon: Camera, isAction: true },
  { href: "/main/friends", label: "Friends", icon: Users },
  { href: "/main/profile", label: "Profile", icon: User },
] as const;

interface NavBarProps {
  /** Current path, or null when it isn't known yet (prerender). */
  pathname: string | null;
  hasUnread: boolean;
  hasPendingRequests: boolean;
}

/**
 * The nav markup, in one place.
 *
 * Everything request-dependent arrives as a prop, so the same render can
 * produce both the fully-live nav and a request-free version of it. Keeping a
 * single source matters: the obvious alternative — a hand-written "shell" copy
 * alongside the real one — drifts silently the first time someone edits one
 * and not the other.
 */
function NavBar({ pathname, hasUnread, hasPendingRequests }: NavBarProps) {
  const openCapture = useQuickCaptureStore((s) => s.open);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-[var(--color-bg-elevated)] border-t border-[var(--color-bg-secondary)] pb-[env(safe-area-inset-bottom)]"
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon, ...rest }) => {
          const isAction = "isAction" in rest && rest.isAction;
          const isActive = pathname !== null && pathname.startsWith(href);

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
              prefetch={true}
              className={cn(
                "flex flex-col items-center justify-center gap-1 min-w-[64px] py-1 transition-colors",
                isActive
                  ? "text-[var(--color-brand)]"
                  : "text-[var(--color-text-tertiary)]",
              )}
              aria-current={isActive ? "page" : undefined}
              aria-label={showBadge ? `${label}, new activity` : label}
            >
              <span className="relative" {...(label === "Feed" ? { "data-nav": "feed" } : {})}>
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

/** The nav with everything it needs from the request: path and unread badges. */
function BottomNavLive() {
  const userId = useAuthUserId();
  const pathname = usePathname();
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
    <NavBar
      pathname={pathname}
      hasUnread={hasUnread}
      hasPendingRequests={hasPendingRequests}
    />
  );
}

/**
 * The persistent chrome.
 *
 * The markup lives in `NavBar` and takes everything request-dependent as
 * props, so a request-free version of the bar — right geometry, right links,
 * capture button working, just no active highlight or unread badges — is one
 * call away.
 *
 * There is deliberately **no** `<Suspense>` boundary around `BottomNavLive`
 * here, even though that is what a prerendered app shell would need.
 * `usePathname()` only suspends during prerendering, which this app does not
 * do for `/main/*` (the CSP nonce forces dynamic rendering — DIAGNOSIS.md
 * Phase 5), so the fallback would never render. Measured, it is not free:
 * wrapping this cost ~14ms of TBT (47ms -> 61ms, reproduced across three
 * 5-run samples) for no behavioral change.
 *
 * If that constraint ever lifts, the boundary is a three-line addition:
 *   <Suspense fallback={<NavBar pathname={null} hasUnread={false}
 *                               hasPendingRequests={false} />}>
 */
export function BottomNav() {
  return <BottomNavLive />;
}
