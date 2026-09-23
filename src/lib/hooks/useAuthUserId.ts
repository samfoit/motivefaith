"use client";

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { readLocalUserId } from "@/lib/auth/local-session";

/**
 * Cached so `getSnapshot` is cheap and referentially stable across renders —
 * `useSyncExternalStore` calls it on every render and compares with Object.is,
 * so re-parsing `document.cookie` each time would be wasteful (though not
 * incorrect: the result is a primitive).
 */
let cachedUserId: string | null | undefined;

function getSnapshot(): string | null {
  if (cachedUserId === undefined) cachedUserId = readLocalUserId();
  return cachedUserId;
}

/** The server has no cookie, so it must render the signed-out shape. */
function getServerSnapshot(): string | null {
  return null;
}

function subscribe(onChange: () => void) {
  const supabase = createClient();
  const { data } = supabase.auth.onAuthStateChange(() => {
    cachedUserId = readLocalUserId();
    onChange();
  });
  return () => data.subscription.unsubscribe();
}

/**
 * The signed-in user's id, or null when signed out.
 *
 * Read straight from the Supabase auth cookie rather than via `getSession()`,
 * for two reasons:
 *
 *  - It is synchronous. `getSession()` resolved in an effect left the value
 *    null for the first render *and* a microtask beyond it, and every badge
 *    query in TopBar/BottomNav is `enabled: !!userId` — so they each waited on
 *    it (DIAGNOSIS R7).
 *  - It survives an expired access token. Offline, `getSession()` returns null
 *    once the token expires, because refreshing needs the network. That would
 *    blank the user id and disable every query precisely when the offline
 *    cache is the only thing left to render from. The cookie is still there.
 *
 * This is an identity *hint*, never an authorization decision — see
 * `src/lib/auth/local-session.ts`. The server authorizes every real read.
 */
export function useAuthUserId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
