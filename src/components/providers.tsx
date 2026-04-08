"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { usePathname } from "next/navigation";
import { useServiceWorker } from "@/lib/hooks/useServiceWorker";
import { initializeTheme } from "@/lib/stores/theme-store";
import { getBrowserTimezone } from "@/lib/utils/timezone";
import { createClient } from "@/lib/supabase/client";
import { createIDBPersister } from "@/lib/query-persister";

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
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith("/main") || pathname.startsWith("/auth/onboarding");

  useServiceWorker();

  useEffect(() => {
    initializeTheme();
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000, // 2 min — matches most hook overrides
            gcTime: 24 * 60 * 60 * 1000, // 24h — persist-client needs gcTime >= maxAge
            refetchOnWindowFocus: "always", // refresh data when user returns to app
          },
        },
      }),
  );

  const [persistOptions] = useState(() => ({
    persister: createIDBPersister(),
    maxAge: 24 * 60 * 60 * 1000, // 24h — offline data stays usable for a day
    buster: "", // change to bust persisted cache on breaking schema changes
  }));

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {isAuthRoute && <AuthHooks />}
      {children}
    </PersistQueryClientProvider>
  );
}
