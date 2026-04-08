"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getPendingCount } from "@/lib/offline-queue";

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

  useEffect(() => {
    if (!online) {
      getPendingCount().then(setPending);
    }
  }, [online]);

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
