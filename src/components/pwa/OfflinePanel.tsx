"use client";

import { WifiOff } from "lucide-react";

interface OfflinePanelProps {
  /** What could not be loaded, e.g. "your habits". */
  what: string;
  onRetry?: () => void;
}

/**
 * Shown in place of a section whose data could not be loaded and is not in the
 * cache either.
 *
 * Deliberately inline rather than a full-screen takeover: being offline should
 * not replace the app with a dead end. The chrome stays, navigation still
 * works, and anything already cached still renders — only the part that
 * genuinely needs the network says so.
 */
export function OfflinePanel({ what, onRetry }: OfflinePanelProps) {
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-[var(--color-bg-secondary)] bg-[var(--color-bg-elevated)] px-4 py-10 text-center">
      <WifiOff className="h-6 w-6 text-[var(--color-text-secondary)]" aria-hidden />
      <p className="text-sm font-medium text-[var(--color-text-primary)]">
        {online ? `Couldn't load ${what}` : `${what} need a connection`}
      </p>
      <p className="max-w-xs text-sm text-[var(--color-text-secondary)]">
        {online
          ? "Something went wrong reaching the server."
          : "Reconnect to see this. Anything you've already logged is saved and will sync."}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
