"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/types";

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
 * Serialize a PushSubscription to a plain JSON-safe object for storage.
 */
function serializeSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? null,
      auth: json.keys?.auth ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

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
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (sub) {
          setState("subscribed");
        } else {
          setState(Notification.permission === "default" ? "prompt" : "unsubscribed");
        }
      })
      .catch(() => {
        setState("unsupported");
      });
  }, []);

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

      // Persist to Supabase
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ push_subscription: serializeSubscription(sub) as unknown as Json })
        .eq("id", userId);

      if (error) throw error;

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
  }, [userId]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }

      // Clear from Supabase
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ push_subscription: null })
        .eq("id", userId);

      if (error) throw error;

      setState("unsubscribed");
    } catch (err) {
      console.error("Failed to unsubscribe from push:", err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  return { state, isLoading, subscribe, unsubscribe };
}
