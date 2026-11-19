"use client";

import { useEvidenceUrl } from "@/lib/hooks/useEvidenceUrl";
import { Skeleton } from "@/components/ui/Skeleton";
import { MediaUnavailable } from "@/components/ui/MediaUnavailable";
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
  const { status, url, markBroken } = useEvidenceUrl(path);

  if (status === "gone" || status === "failed") {
    return <MediaUnavailable type="voice" reason={status} className={className} />;
  }

  if (!url) {
    return (
      <div className={cn("h-9 w-40 max-w-full rounded-full overflow-hidden", className)}>
        <Skeleton variant="rect" className="w-full h-full" />
      </div>
    );
  }

  return <AudioPlayer src={url} waveKey={path} onError={markBroken} className={className} />;
}
