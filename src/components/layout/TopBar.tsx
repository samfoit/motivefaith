"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { InboxBell } from "./InboxBell";
import { registerActionsSlot, registerTitleSlot } from "./TopBarSlots";
import { TOP_BAR_TITLE_CLASS, TOP_BAR_TITLE_STYLE } from "./topBarStyles";

/**
 * Screens whose title the bar shows in place of the wordmark.
 *
 * These pages used to draw the wordmark bar and then their own title row
 * under it — two headers, ~150px of chrome before any content on a phone.
 * Now the bar is the header: it names the screen, and the page puts its own
 * buttons into it (see `TopBarActions`). `null` means the page supplies the
 * title itself (`TopBarTitle`) — the dashboard's greeting, which can only be
 * rendered on the client.
 *
 * Titles are known from the path alone, so they are server-rendered and in
 * the first paint; only page-specific buttons arrive after hydration.
 */
const SCREEN_TITLES: Record<string, string | null> = {
  "/main/dashboard": null,
  "/main/feed": "Feed",
  "/main/friends": "Friends",
  "/main/inbox": "Inbox",
  "/main/profile": "Profile",
};

export function TopBar() {
  const pathname = usePathname();
  const isScreen = pathname in SCREEN_TITLES;
  const title = SCREEN_TITLES[pathname];

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 h-14 bg-header border-b border-border">
      {isScreen ? (
        <div ref={registerTitleSlot} className="min-w-0">
          {title && (
            <h1 className={TOP_BAR_TITLE_CLASS} style={TOP_BAR_TITLE_STYLE}>
              {title}
            </h1>
          )}
        </div>
      ) : (
        <Link
          href="/main/dashboard"
          className="font-display text-lg font-medium text-[var(--color-text-primary)]"
        >
          MotiveFaith
        </Link>
      )}

      {/* -mr-2: the bell's icon, not its padded box, lines up with the 16px
          gutter, matching the title's left edge. */}
      <div className="flex items-center gap-2 shrink-0 -mr-2">
        {isScreen && (
          <div ref={registerActionsSlot} className="flex items-center gap-2 empty:hidden" />
        )}
        {/* The bell on the inbox itself would only link to where you are. */}
        {pathname !== "/main/inbox" && <InboxBell />}
      </div>

    </header>
  );
}
