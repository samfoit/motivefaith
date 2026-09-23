/**
 * Erase every trace of the signed-in user's data from this device.
 *
 * Offline-first means the app deliberately keeps real user data on the client:
 * habits and completions in the persisted React Query cache, unsent writes in
 * the outbox. That is the whole point — and it is also a liability the moment
 * the user signs out, especially on a shared device. This is the counterweight.
 *
 * Deliberately NOT cleared: Cache Storage. Under the app-shell design the
 * cached `/main/*` documents contain no user data — that is what makes them
 * safe to cache at all — so keeping them costs nothing and gives the next
 * person an instant shell. Clearing them would only slow down the next sign-in.
 * (See the caching rules in `src/sw/service-worker.js`.)
 *
 * Also not cleared: the theme preference and the install-prompt dismissal,
 * which are device preferences rather than anyone's personal data.
 */

import { del } from "idb-keyval";

/** Must match the key in `src/lib/query-persister.ts`. */
const QUERY_CACHE_KEY = "motive-query-cache";

/** Must match DB_NAME in `src/lib/offline-queue.ts`. */
const OFFLINE_DB = "motive-offline";

/** sessionStorage prefixes that hold per-user state. */
const SESSION_PREFIXES = ["dismissed-inbox-", "motive-rl:"];

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(name);
    } catch {
      resolve();
      return;
    }
    // `blocked` fires when another tab still holds the database open. Resolve
    // anyway rather than hanging the sign-out: the delete completes once the
    // other connection closes, and that tab is signing out too.
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function clearSessionKeys() {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && SESSION_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
    }
    for (const key of doomed) sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode, blocked cookies) — nothing to clear */
  }
}

/**
 * Best-effort, never-throwing. A failure here must not block sign-out: leaving
 * the user signed in on a device they are trying to leave is strictly worse
 * than leaving a stale cache behind, and the `buster` in
 * `src/components/providers.tsx` discards that cache on the next mount anyway.
 */
export async function purgeLocalUserData(): Promise<void> {
  clearSessionKeys();
  await Promise.allSettled([
    del(QUERY_CACHE_KEY),
    deleteDatabase(OFFLINE_DB),
  ]);
}
