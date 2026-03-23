"use client";

import { Button } from "@/components/ui/Button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-4">😵</div>
        <h1
          className="font-display font-bold text-[var(--color-text-primary)] mb-2"
          style={{ fontSize: "var(--text-xl)" }}
        >
          Something went wrong
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">
          {error.message || "Failed to load your dashboard"}
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
