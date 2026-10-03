"use client";

import { useState, useEffect } from "react";
import { resolveEvidenceUrl } from "@/lib/utils/evidence";
import { Skeleton } from "@/components/ui/Skeleton";
import { AudioPlayer } from "@/components/ui/AudioPlayer";
import { cn } from "@/lib/utils/cn";

interface EvidenceAudioProps {
  /** Storage path or legacy signed URL stored in evidence_url column. */
  path: string;
  className?: string;
}

/**
 * Renders completion evidence audio from a storage path.
 *
 * Follows the same URL-resolution pattern as EvidenceMedia —
 * resolves storage paths to short-lived signed URLs at render time.
 */
export function EvidenceAudio({ path, className }: EvidenceAudioProps) {
  const isLegacy = path.startsWith("http");
  const [resolved, setResolved] = useState<{ path: string; url: string | null }>({
    path: "",
    url: null,
  });

  useEffect(() => {
    if (isLegacy) return;

    let canceled = false;
    resolveEvidenceUrl(path)
      .then((signedUrl) => {
        if (!canceled) setResolved({ path, url: signedUrl });
      })
      .catch((err) => {
        console.error("Failed to resolve evidence URL:", err);
        if (!canceled) setResolved({ path, url: null });
      });
    return () => {
      canceled = true;
    };
  }, [path, isLegacy]);

  const url = isLegacy ? path : (resolved.path === path ? resolved.url : null);

  if (!url) {
    return (
      <div className={cn("h-9 w-56 max-w-full rounded-full overflow-hidden", className)}>
        <Skeleton variant="rect" className="w-full h-full" />
      </div>
    );
  }

  return <AudioPlayer src={url} className={className} />;
}
