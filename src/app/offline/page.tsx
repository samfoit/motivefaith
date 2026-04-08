"use client";

import { useEffect, useState } from "react";
import { getPendingCount } from "@/lib/offline-queue";

export default function OfflinePage() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    getPendingCount().then(setPending);

    const goOnline = () => setOnline(true);
    window.addEventListener("online", goOnline);
    return () => window.removeEventListener("online", goOnline);
  }, []);

  // Auto-redirect to dashboard when connectivity returns
  useEffect(() => {
    if (online) {
      window.location.href = "/main/dashboard";
    }
  }, [online]);

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 bg-[var(--color-bg-primary)]">
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-4">📡</div>
        <h1
          className="font-display font-bold text-[var(--color-text-primary)] mb-2"
          style={{ fontSize: "var(--text-xl)" }}
        >
          You&apos;re offline
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Your habits are safe. Any completions you logged will sync
          automatically when you reconnect.
        </p>
        {pending > 0 && (
          <p className="text-sm text-[var(--color-text-secondary)] mb-6">
            <span className="font-semibold text-[var(--color-text-primary)]">
              {pending}
            </span>{" "}
            {pending === 1 ? "completion" : "completions"} waiting to sync
          </p>
        )}
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
