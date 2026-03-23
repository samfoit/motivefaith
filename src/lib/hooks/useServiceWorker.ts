"use client";

import { useEffect } from "react";

/**
 * Registers the service worker on mount and listens for updates.
 * When a new version is installed, prompts the user to reload.
 * Safe to call multiple times — the browser deduplicates registrations.
 */
export function useServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            // Only prompt when there's an existing controller (i.e. not first install)
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // A new version is ready — prompt the user to reload
              if (window.confirm("A new version of MotiveFaith is available. Reload to update?")) {
                window.location.reload();
              }
            }
          });
        });
      })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  }, []);
}
