"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

/**
 * `navigator.onLine`, re-rendering when it changes.
 *
 * What the browser believes, which is good enough for telling the user they
 * are offline — not for deciding whether a request will get through. A write
 * still has to try, and fall back to the outbox when it fails (see
 * `isOfflineError`).
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
