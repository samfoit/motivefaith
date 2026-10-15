"use client";

import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUpdateStore, applyUpdate } from "@/lib/stores/update-store";
import { isThreadRoute } from "@/lib/utils/thread-route";

/**
 * Offers a waiting app update as a quiet banner, in place of the
 * window.confirm() that used to block the page the moment it installed.
 *
 * Refreshing is the user's call: "Later" hides it for this page, and the new
 * version also takes over on its own once every tab of the app is closed.
 *
 * Never shown on /auth/ pages. A refresh restarts an auth flow, which on the
 * reset-password page landed the user on "link expired" mid-reset.
 */
export function UpdatePrompt() {
  const pathname = usePathname() ?? "";
  const waiting = useUpdateStore((s) => s.waiting);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const dismiss = useUpdateStore((s) => s.dismiss);

  if (!waiting || dismissed || pathname.startsWith("/auth/")) return null;

  // Above the bottom nav inside the app; at the foot of the page elsewhere.
  // On a chat screen the composer owns the bottom — it rides up with the
  // keyboard, and a banner there would sit on what someone is typing — so
  // the offer drops in under the top bar instead.
  const inApp = pathname.startsWith("/main");
  const inThread = isThreadRoute(pathname);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 z-50 px-4",
        inThread
          ? "update-prompt-drop top-16"
          : cn(
              "install-prompt-enter pb-[env(safe-area-inset-bottom)]",
              inApp ? "bottom-20" : "bottom-4",
            ),
      )}
    >
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 pl-4 shadow-lg">
        <RefreshCw aria-hidden className="h-4 w-4 shrink-0 text-brand-ink" />
        <p className="min-w-0 flex-1 text-sm text-text-primary">
          A new version of MotiveFaith is ready.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover"
        >
          Later
        </button>
        <button
          type="button"
          onClick={applyUpdate}
          className="min-h-11 shrink-0 rounded-lg bg-brand px-4 text-sm font-medium text-on-brand transition-colors hover:bg-brand-hover"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
