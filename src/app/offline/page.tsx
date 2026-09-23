"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPendingCount, getOutboxCount } from "@/lib/offline-queue";

/**
 * Last-resort offline screen.
 *
 * This used to be where *every* offline navigation to `/main/*` ended up, with
 * no way forward — the app was simply gone, even for a screen the user had
 * open seconds earlier (DIAGNOSIS.md R1). The dashboard now works offline from
 * a cached shell, so this page is only reached for routes whose HTML still
 * embeds user data and therefore still cannot be cached: the feed, friends and
 * inbox, which need a connection to be worth anything anyway.
 *
 * So it is a signpost rather than a dead end: it says which part of the app is
 * still available and sends the user there.
 */
export default function OfflinePage() {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    Promise.all([getPendingCount(), getOutboxCount()])
      .then(([completions, writes]) => setPending(completions + writes))
      .catch(() => setPending(0));

    // Reconnecting should take the user back to something useful, not leave
    // them looking at an offline screen that is no longer true.
    const goOnline = () => {
      window.location.href = "/main/dashboard";
    };
    window.addEventListener("online", goOnline);
    return () => window.removeEventListener("online", goOnline);
  }, []);

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
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">
          This page needs a connection — but your habits don&apos;t.
        </p>

        <Link
          href="/main/dashboard"
          className="inline-flex w-full items-center justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          Go to your habits
        </Link>

        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          You can check them off offline. The feed, friends and inbox need a
          connection.
        </p>

        {pending > 0 && (
          <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
            <span className="font-semibold text-[var(--color-text-primary)]">
              {pending}
            </span>{" "}
            {pending === 1 ? "change" : "changes"} waiting to sync
          </p>
        )}

        <button
          onClick={() => window.location.reload()}
          className="mt-4 text-sm font-medium text-[var(--color-text-secondary)] underline underline-offset-4 transition-colors hover:text-[var(--color-text-primary)]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
