"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Activity, Camera, Users, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useQuickCaptureStore } from "@/lib/stores/quick-capture-store";

const NAV_ITEMS = [
  { href: "/main/dashboard", label: "Home", icon: Home },
  { href: "/main/feed", label: "Feed", icon: Activity },
  { href: "", label: "Capture", icon: Camera, isAction: true },
  { href: "/main/friends", label: "Friends", icon: Users },
  { href: "/main/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const openCapture = useQuickCaptureStore((s) => s.open);

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
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
