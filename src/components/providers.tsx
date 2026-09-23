"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { QueryClient, type Query } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { usePathname } from "next/navigation";
import { useServiceWorker } from "@/lib/hooks/useServiceWorker";
import { useOutboxDrain } from "@/lib/hooks/useOutboxDrain";
import { initializeTheme } from "@/lib/stores/theme-store";
import { getBrowserTimezone } from "@/lib/utils/timezone";
import { createClient } from "@/lib/supabase/client";
import { createIDBPersister } from "@/lib/query-persister";
import { readLocalUserId } from "@/lib/auth/local-session";
import { purgeLocalUserData } from "@/lib/auth/purge-local-data";

/**
 * Detect the browser's IANA timezone and sync it to the user's profile
 * so that the DB trigger and server components use the same timezone.
 * Only writes when the stored value differs from the detected value.
 */
function useSyncTimezone() {
  useEffect(() => {
    const tz = getBrowserTimezone();
    if (!tz || tz === "UTC") return; // Don't overwrite with a non-specific default

    const sync = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Single query: only updates when the stored value differs.
      // The WHERE clause short-circuits the write (no WAL/trigger overhead)
      // when the timezone already matches.
      await supabase
        .from("profiles")
        .update({ timezone: tz })
        .eq("id", user.id)
        .neq("timezone", tz);
    };

    sync().catch(() => {
      /* non-critical — next page load will retry */
    });
  }, []);
}

/** Sign the user out after 30 minutes of inactivity. */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
];

function useInactivityTimeout() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.auth.signOut();
        window.location.href = "/auth/login";
      }
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  // Debounced version for high-frequency events (scroll, pointermove).
  // Leading-edge: resets immediately on first event, then ignores for 500ms.
  const debouncedReset = useCallback(() => {
    if (debounceRef.current) return;
    resetTimer();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
    }, 500);
  }, [resetTimer]);

  useEffect(() => {
    resetTimer();
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, debouncedReset, { passive: true });
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const evt of ACTIVITY_EVENTS) {
        document.removeEventListener(evt, debouncedReset);
      }
    };
  }, [resetTimer, debouncedReset]);
}

/**
 * Auth-dependent hooks that should only run on authenticated routes.
 * Avoids unnecessary getUser() calls on the landing page and public routes.
 */
function AuthHooks() {
  useSyncTimezone();
  useInactivityTimeout();
  // Scoped to authenticated routes: a drain needs a session, and on a public
  // page every request would 401 and leave the queue untouched anyway.
  useOutboxDrain();
  return null;
}

/**
 * Decides whether the auth-only hooks should run, and renders nothing.
 *
 * Kept as its own leaf so the `usePathname()` subscription lives here rather
 * than on `Providers`. `Providers` wraps the entire app, so subscribing it to
 * route changes made every navigation re-render the whole provider tree; this
 * narrows that to a component with no output. It also keeps the read out of
 * the way of prerendering, where `usePathname()` suspends on routes with
 * dynamic params.
 */
function AuthHooksGate() {
  const pathname = usePathname();
  const isAuthRoute =
    pathname.startsWith("/main") || pathname.startsWith("/auth/onboarding");
  return isAuthRoute ? <AuthHooks /> : null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  useServiceWorker();

  useEffect(() => {
    initializeTheme();
  }, []);

  // One listener rather than a cleanup call at each sign-out site. This also
  // covers the paths that never had one: the inactivity timeout above,
  // account deletion, a refresh token that fails, and /auth/stale (which
  // signs out server-side, so the client only learns about it when the
  // cookie is gone and this fires on the next boot).
  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        void purgeLocalUserData();
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000, // 2 min — matches most hook overrides
            gcTime: 24 * 60 * 60 * 1000, // 24h — persist-client needs gcTime >= maxAge
            refetchOnWindowFocus: "always", // refresh data when user returns to app
            // Attempt the fetch once even when `navigator.onLine` is false,
            // then fall through to the persisted cache on failure.
            //
            // The default ("online") leaves an offline query parked in
            // `status: "pending" / fetchStatus: "paused"` forever — it never
            // calls queryFn, so it can neither surface an error nor fall back,
            // and every consumer has to special-case that state. "offlineFirst"
            // gives a clean `isError` to branch offline UI on, and it also
            // covers the cases `navigator.onLine` gets wrong: lie-fi, captive
            // portals, and responses the service worker can serve from cache
            // with no network at all.
            networkMode: "offlineFirst",
          },
          // NOTE: mutations deliberately keep the default `networkMode:
          // "online"`, which pauses them while offline and auto-resumes on
          // reconnect. Mutations that handle offline themselves — by writing
          // to the outbox inside `mutationFn` — must opt out per-mutation with
          // `networkMode: "always"`, because a paused mutation never calls
          // `mutationFn` at all. See `src/lib/offline-write.ts`.
        },
      }),
  );

  const [persistOptions] = useState(() => ({
    persister: createIDBPersister(),
    maxAge: 24 * 60 * 60 * 1000, // 24h — offline data stays usable for a day
    // Partition the persisted cache by user. PersistQueryClientProvider
    // discards the restored cache outright when `buster` changes, so a
    // different user — or a signed-out visitor — on this device can never be
    // handed the previous user's habits out of IndexedDB. That matters far
    // more now that the cache holds real data for offline use.
    //
    // `readLocalUserId()` never returns another user's id: worst case it
    // returns null, which buckets as "anon" and discards.
    //
    // NOTE: captured once, at mount. Sign-out must therefore be a full
    // document navigation so this remounts and re-reads — see the comment on
    // `handleSignOut` in src/app/main/profile/profile-client.tsx.
    buster: readLocalUserId() ?? "anon",
    dehydrateOptions: {
      /**
       * Persist any query that HAS data, not only one whose last fetch
       * succeeded.
       *
       * React Query's default is `status === "success"`. That is wrong for an
       * offline-first app, and quietly so: offline, the restored query
       * refetches, the refetch fails, and the query flips to "error" while
       * still holding the data it restored. Under the default it is then
       * excluded from every subsequent write — so an optimistic completion
       * logged offline never reaches IndexedDB, and the habits already stored
       * there are dropped the next time the cache is persisted. The user
       * reloads and their dashboard is empty.
       *
       * Verified against a real offline reload; `data !== undefined` is what
       * keeps the cache alive across one.
       */
      shouldDehydrateQuery: (query: Query) =>
        query.state.status === "success" || query.state.data !== undefined,
    },
  }));

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthHooksGate />
      {children}
    </PersistQueryClientProvider>
  );
}
