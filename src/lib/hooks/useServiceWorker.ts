"use client";

import { useEffect } from "react";
import { useUpdateStore } from "@/lib/stores/update-store";

/**
 * Registers the service worker on mount and listens for updates.
 * When a new version is installed, hands it to UpdatePrompt, which offers a
 * refresh in an in-app banner.
 * Safe to call multiple times — the browser deduplicates registrations.
 */
export function useServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Don't register the SW in development — its cache-first strategy for
    // static assets serves stale Turbopack bundles on dev server restart,
    // causing env-var and source-map errors until a hard refresh.
    if (process.env.NODE_ENV === "development") return;

    // Request persistent storage so the browser won't evict Cache Storage
    // or IndexedDB (queued offline completions) under storage pressure.
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        const { setWaiting } = useUpdateStore.getState();

        // A worker left waiting from an earlier visit ("Later", or a tab
        // closed before refreshing) is still an update to offer.
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaiting(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            // Only offer it when there's an existing controller (i.e. not
            // first install). UpdatePrompt decides when to show the offer;
            // it stays out of auth flows.
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(newWorker);
            }
          });
        });
      })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  }, []);
}
