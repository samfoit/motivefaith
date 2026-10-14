"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PushState =
  | "unsupported"
  | "requires-install"
  | "denied"
  | "prompt"
  | "unsubscribed"
  | "subscribed";

/**
 * Detect if the current device is iOS (iPhone/iPad/iPod).
 */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // Primary check: UA string covers iPhone/iPad (request desktop site off) / iPod
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPad with "Request Desktop Website" reports as Mac — detect via touch support.
  // navigator.platform is deprecated but still widely populated; use userAgentData
  // where available, falling back to platform for older browsers.
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return platform === "macOS" || platform === "MacIntel"
    ? navigator.maxTouchPoints > 1
    : false;
}

/**
 * Detect if the app is running in standalone (installed PWA) mode.
 */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a base64url VAPID public key to a Uint8Array for pushManager.subscribe.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output as Uint8Array<ArrayBuffer>;
}

/**
 * Whether a subscription's applicationServerKey matches the base64url VAPID key.
 */
function sameKey(serverKey: ArrayBuffer | null, vapidKey: string): boolean {
  if (!serverKey) return false;
  const a = new Uint8Array(serverKey);
  const b = urlBase64ToUint8Array(vapidKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Store this device's subscription. Each device has its own row, so saving
 * never displaces another device's.
 */
async function saveSubscription(sub: PushSubscription): Promise<void> {
  const { keys } = sub.toJSON();
  if (!keys?.p256dh || !keys?.auth) throw new Error("Push subscription has no keys");
  const { error } = await createClient().rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
  });
  if (error) throw error;
}

/** Remove this device's stored subscription, leaving the user's other devices. */
async function deleteSubscription(endpoint: string): Promise<void> {
  const { error } = await createClient().rpc("delete_push_subscription", {
    p_endpoint: endpoint,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Push state for this device. `userId` re-runs the sync when the signed-in
 * user changes; the stored row is always written as the current auth user.
 */
export function usePushSubscription(userId: string) {
  const [state, setState] = useState<PushState>("unsupported");
  const [isLoading, setIsLoading] = useState(false);

  // Determine initial state
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    // iOS requires the app to be installed as a PWA for push to work
    if (isIOS() && !isStandalone()) {
      setState("requires-install");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    // Check for an existing subscription
    navigator.serviceWorker.ready
      .then(async (reg) => {
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          setState(Notification.permission === "default" ? "prompt" : "unsubscribed");
          return;
        }
        setState("subscribed");

        try {
          // A subscription made under a different VAPID key (e.g. after a key
          // rotation) is rejected by the push service, so replace it.
          const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
          if (vapidKey && !sameKey(sub.options.applicationServerKey, vapidKey)) {
            await deleteSubscription(sub.endpoint);
            await sub.unsubscribe();
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidKey),
            });
          }

          // The stored row can be cleared server-side while the browser still
          // holds a live subscription — re-save it so the two stay in step.
          await saveSubscription(sub);
        } catch (err) {
          console.error("Failed to sync push subscription:", err);
        }
      })
      .catch(() => {
        setState("unsupported");
      });
  }, [userId]);

  const subscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");

      // iOS requires an explicit permission request from a user gesture
      // before pushManager.subscribe() will work
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState("denied");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      await saveSubscription(sub);

      setState("subscribed");
    } catch (err) {
      console.error("Failed to subscribe to push:", err);
      // Re-check permission in case user denied the prompt
      if (Notification.permission === "denied") {
        setState("denied");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        // Only this device — the user's other devices keep their notifications
        await deleteSubscription(sub.endpoint);
        await sub.unsubscribe();
      }

      setState("unsubscribed");
    } catch (err) {
      console.error("Failed to unsubscribe from push:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { state, isLoading, subscribe, unsubscribe };
}
