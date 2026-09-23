import Link from "next/link";
import { Plus } from "lucide-react";
import { DashboardClient } from "./dashboard-client";

/**
 * The dashboard shell — deliberately free of user data.
 *
 * This page used to fetch the user's profile, habits, completions and
 * challenges here and pass them down, which put the user's name and habits
 * straight into the HTML. That is why `src/sw/service-worker.js` refused to
 * cache any `/main/*` document: caching it would leave one person's data in
 * Cache Storage, readable after logout and by the next person on a shared
 * device. With nothing cached there was no shell to fall back to offline, so
 * every offline navigation landed on the dead-end `/offline` page — even for a
 * screen the user had open seconds earlier (DIAGNOSIS.md R1).
 *
 * Now the markup below is identical for every user, so it is safe to cache and
 * safe to replay. The data arrives separately from `/api/dashboard`, through
 * React Query, persisted to IndexedDB — which is what the cached shell renders
 * from when there is no network.
 *
 * There is deliberately no `getAuthUser()` check here: `src/proxy.ts` already
 * redirects unauthenticated `/main/*` requests to the login page, and
 * `AuthGate` in `src/app/main/layout.tsx` still gates the whole subtree on a
 * verified session. Adding a third check would only be another round trip, and
 * a `redirect()` here would make the response `redirected`, which the service
 * worker refuses to cache.
 */
export default function DashboardPage() {
  // No `min-h-screen` here, deliberately: the layout's root is already
  // `min-h-dvh` and paints the background. Inside `main` — which starts below
  // a 56px TopBar and carries the bottom-nav clearance — a full-viewport
  // minimum could only overflow, and did: a short day left ~150px of empty
  // scroll under the nav on every phone.
  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4 sm:pt-6 sm:space-y-6">
      <DashboardClient
        headerAction={
          <Link
            href="/main/habits/new"
            aria-label="Create new habit"
            className="flex items-center justify-center w-9 h-9 rounded-full bg-brand text-text-primary hover:bg-brand-hover transition-colors"
          >
            <Plus className="w-5 h-5" />
          </Link>
        }
      />
    </div>
  );
}
