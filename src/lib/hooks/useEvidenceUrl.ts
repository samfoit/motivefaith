"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveEvidenceUrl } from "@/lib/utils/evidence";

/**
 *   loading  still asking Storage
 *   ready    `url` is good to play or show
 *   gone     Storage has nothing this person may read: the file was removed,
 *            or whatever shared it was taken down. It will not come back.
 *   failed   Storage could not be asked (offline, a failed request). Tried
 *            again when the connection returns.
 */
export type EvidenceStatus = "loading" | "ready" | "gone" | "failed";

interface Resolved {
  path: string;
  attempt: number;
  status: Exclude<EvidenceStatus, "loading">;
  url: string | null;
}

/**
 * A storage path (or a legacy signed URL) as something to render, with what
 * to say when it cannot be shown. `markBroken` is for the element's own
 * `onError`: a legacy link that has expired is gone; a fresh signed URL that
 * will not load is a failure, tried again on reconnect.
 */
export function useEvidenceUrl(path: string) {
  const isLegacy = path.startsWith("http");
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (isLegacy) return;
    let canceled = false;
    resolveEvidenceUrl(path)
      .then((url) => {
        if (!canceled) {
          setResolved({ path, attempt, status: url ? "ready" : "gone", url });
        }
      })
      .catch((err) => {
        console.error("Failed to resolve evidence URL:", err);
        if (!canceled) setResolved({ path, attempt, status: "failed", url: null });
      });
    return () => {
      canceled = true;
    };
  }, [path, isLegacy, attempt]);

  // Ask again when the connection comes back, not straight away: a request
  // that failed while online would only fail again.
  const failed = resolved?.path === path && resolved.status === "failed";
  useEffect(() => {
    if (!failed) return;
    const retry = () => setAttempt((n) => n + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [failed]);

  const markBroken = useCallback(() => {
    setResolved({
      path,
      attempt,
      status: isLegacy ? "gone" : "failed",
      url: null,
    });
  }, [path, attempt, isLegacy]);

  // A legacy URL is ready as it stands, until the element says otherwise.
  const current =
    resolved?.path === path && (isLegacy || resolved.attempt === attempt) ? resolved : null;
  if (current) return { status: current.status, url: current.url, markBroken };
  if (isLegacy) return { status: "ready" as const, url: path, markBroken };
  return { status: "loading" as const, url: null, markBroken };
}
