"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PushState =
  | "unsupported"
  | "denied"
  | "prompt"
  | "unsubscribed"
  | "subscribed";

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
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
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
