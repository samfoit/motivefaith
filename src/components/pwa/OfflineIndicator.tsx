"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getPendingCount, getOutboxCount } from "@/lib/offline-queue";
import { subscribeToPending } from "@/lib/outbox-drain";

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

export function OfflineIndicator() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [pending, setPending] = useState(0);

  const refresh = useCallback(() => {
    // Completions and other queued writes both count as "pending" to the user.
    Promise.all([getPendingCount(), getOutboxCount()])
      .then(([completions, writes]) => setPending(completions + writes))
      .catch(() => setPending(0));
  }, []);

  useEffect(() => {
    if (!online) refresh();
    // Re-read whenever something queues or drains, so the count is live
    // rather than a snapshot taken when the banner first appeared.
    return subscribeToPending(refresh);
  }, [online, refresh]);

  if (online) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-xs font-medium text-white dark:bg-amber-600">
      <span>You&apos;re offline</span>
      {pending > 0 && (
        <span className="rounded-full bg-white/20 px-1.5 py-0.5">
          {pending} pending
        </span>
      )}
    </div>
  );
}
