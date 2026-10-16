"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { InboxBell } from "./InboxBell";
import {
  getTopBarBackHandler,
  registerActionsSlot,
  registerTitleSlot,
} from "./TopBarSlots";
import {
  TOP_BAR_ICON_BUTTON_CLASS,
  TOP_BAR_TITLE_CLASS,
  TOP_BAR_TITLE_STYLE,
} from "./topBarStyles";

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

/**
 * Pages you drill into from a screen. The bar gives them a back arrow and
 * their title, in place of the row of each that they used to draw under the
 * wordmark. As with the screens, `null` means the page supplies the title —
 * a friend's or group's name, a habit's — through `TopBarTitle`.
 *
 * `parent` is where the arrow goes when there is nothing in the app to go
 * back to: a page opened from a notification or a shared link.
 */
const SUB_PAGES: { pattern: RegExp; title: string | null; parent: string }[] = [
  { pattern: /^\/main\/habits\/new$/, title: "New Habit", parent: "/main/dashboard" },
  { pattern: /^\/main\/habits\/[^/]+$/, title: null, parent: "/main/dashboard" },
  { pattern: /^\/main\/dashboard\/weekly$/, title: "Weekly Summary", parent: "/main/dashboard" },
  { pattern: /^\/main\/feed\/new-group$/, title: "New Group", parent: "/main/feed" },
  { pattern: /^\/main\/feed\/join\/[^/]+$/, title: "Group Invite", parent: "/main/feed" },
  { pattern: /^\/main\/feed\/group\/([^/]+)\/settings$/, title: "Group Settings", parent: "/main/feed/group/$1" },
  { pattern: /^\/main\/feed\/group\/[^/]+$/, title: null, parent: "/main/feed" },
  { pattern: /^\/main\/feed\/[^/]+$/, title: null, parent: "/main/feed" },
  { pattern: /^\/main\/admin\/moderation$/, title: "Moderation", parent: "/main/profile" },
];

function findSubPage(pathname: string) {
  for (const page of SUB_PAGES) {
    if (page.pattern.test(pathname)) {
      return { title: page.title, parent: pathname.replace(page.pattern, page.parent) };
    }
  }
  return null;
}

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const isScreen = pathname in SCREEN_TITLES;
  const subPage = isScreen ? null : findSubPage(pathname);
  const title = isScreen ? SCREEN_TITLES[pathname] : subPage?.title;

  // The bar lives in the layout and outlasts navigation, so a path change
  // since it mounted means there is an in-app page behind this one.
  // `history.length` can't tell: it counts pages from before the app too.
  const firstPathname = useRef(pathname);
  const hasNavigated = useRef(false);
  useEffect(() => {
    if (pathname !== firstPathname.current) hasNavigated.current = true;
  }, [pathname]);

  const goBack = () => {
    const override = getTopBarBackHandler();
    if (override) override();
    else if (hasNavigated.current) router.back();
    else router.push(subPage?.parent ?? "/main/dashboard");
  };

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 h-14 bg-header border-b border-border">
      {isScreen || subPage ? (
        <div className="flex items-center gap-1 min-w-0">
          {/* -ml-2: the arrow, not its padded box, sits on the 16px gutter. */}
          {subPage && (
            <button
              type="button"
              onClick={goBack}
              className={`${TOP_BAR_ICON_BUTTON_CLASS} -ml-2 shrink-0`}
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div ref={registerTitleSlot} className="min-w-0">
            {title && (
              <h1 className={TOP_BAR_TITLE_CLASS} style={TOP_BAR_TITLE_STYLE}>
                {title}
              </h1>
            )}
          </div>
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
        {(isScreen || subPage) && (
          <div ref={registerActionsSlot} className="flex items-center gap-2 empty:hidden" />
        )}
        {/* Sub-pages are one task at a time, and their own buttons need the
            room; the bell is a tap away on every screen. Nor does the inbox
            need a bell linking to itself. */}
        {!subPage && pathname !== "/main/inbox" && <InboxBell />}
      </div>

    </header>
  );
}
