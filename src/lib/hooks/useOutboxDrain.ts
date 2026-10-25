"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { drainOutbox, setDrainContext } from "@/lib/outbox-drain";
import { createClient } from "@/lib/supabase/client";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";
import { DASHBOARD_KEY_PREFIX } from "@/lib/hooks/useDashboard";

/**
 * Flush queued offline writes whenever connectivity plausibly returned.
 *
 * Mounted once, in `Providers`. Background Sync already covers the
 * app-is-closed case where it exists; this covers the browsers where it does
 * not (all of Safari/iOS) and the cases Background Sync does not fire for,
 * such as the app being reopened after the network came back.
 *
 * `visibilitychange` is here because a backgrounded mobile PWA does not
 * reliably receive `online` — the tab is frozen when the event would fire, and
 * `navigator.onLine` is simply true again by the time the user looks at it.
 */
export function useOutboxDrain() {
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Queued habit edits and reactions replay through the Supabase client,
    // which only exists in a page — hand it to the drain.
    setDrainContext({ supabase: createClient(), userId });
    return () => setDrainContext(null);
  }, [userId]);

  useEffect(() => {
    // The dashboard's refetch on reconnect can land before the drain does —
    // a queued take has a whole upload to get through — and then shows the
    // check-in undone, since the server didn't have it yet. Refetch once the
    // drain has put something there.
    const drain = () => {
      void drainOutbox().then(({ synced }) => {
        if (synced > 0) {
          void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY_PREFIX });
        }
      });
    };

    // Boot: anything left over from a previous session, including writes the
    // service worker never got to sync because SyncManager does not exist.
    if (navigator.onLine) drain();

    const onOnline = () => {
      drain();
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        drain();
      }
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Re-run when the user resolves, so the boot drain happens with a context.
  }, [userId, queryClient]);
}
