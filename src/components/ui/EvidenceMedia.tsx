"use client";

import Image from "next/image";
import { useEvidenceUrl } from "@/lib/hooks/useEvidenceUrl";
import { Skeleton } from "@/components/ui/Skeleton";
import { MediaUnavailable } from "@/components/ui/MediaUnavailable";
import { cn } from "@/lib/utils/cn";

interface EvidenceMediaProps {
  /** Storage path or legacy signed URL stored in evidence_url column. */
  path: string;
  type: "photo" | "video";
  alt?: string;
  className?: string;
  imgClassName?: string;
  videoClassName?: string;
}

/**
 * Renders completion evidence (photo or video) from a storage path.
 *
 * Handles both legacy signed URLs (starting with `http`) and new
 * storage paths by resolving them to short-lived signed URLs at
 * render time.
 *
 * Uses next/image with fill mode inside a fixed-ratio container
 * to prevent CLS while images load. Media that cannot be shown says so in
 * the same frame (see MediaUnavailable).
 */
export function EvidenceMedia({
  path,
  type,
  alt = "Completion evidence",
  className,
  imgClassName,
  videoClassName,
}: EvidenceMediaProps) {
  const isLegacy = path.startsWith("http");
  const { status, url, markBroken } = useEvidenceUrl(path);

  if (status === "gone" || status === "failed") {
    return <MediaUnavailable type={type} reason={status} className={className} />;
  }

  if (!url) {
    return (
      <div className={className}>
        <Skeleton variant="rect" className="w-full h-full" />
      </div>
    );
  }

  if (type === "photo") {
    return (
      <div className={cn("relative aspect-[4/3] overflow-hidden", className)}>
        {isLegacy ? (
          // Legacy/external URLs use a plain img to avoid next/image hostname restrictions
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={alt}
            onError={markBroken}
            className={cn("absolute inset-0 w-full h-full object-cover", imgClassName)}
          />
        ) : (
          <Image
            src={url}
            alt={alt}
            fill
            // Straight from Storage, never through the image optimizer: its
            // cache would keep a resized copy of a private photo (4 hours by
            // default in Next 16) behind a URL that outlives the signed
            // link's hour and the check-in itself. A GIF needs this anyway:
            // the optimizer's re-encoding would stop it moving.
            unoptimized
            onError={markBroken}
            sizes="(max-width: 640px) 100vw, 640px"
            className={cn("object-cover", imgClassName)}
          />
        )}
      </div>
    );
  }

  return (
    <video
      src={url}
      onError={markBroken}
      controls
      playsInline
      // Only enough to show its length and first frame: a list of these must
      // not start pulling down every clip before one is played.
      preload="metadata"
      className={cn("select-none", className, videoClassName)}
      style={{ WebkitTouchCallout: "none" }}
    />
  );
}
