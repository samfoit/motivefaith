"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { resolveEvidenceUrl } from "@/lib/utils/evidence";
import { Skeleton } from "@/components/ui/Skeleton";
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
 * to prevent CLS while images load.
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
  const [resolved, setResolved] = useState<{ path: string; url: string | null }>({
    path: "",
    url: null,
  });

  useEffect(() => {
    if (isLegacy) return;

    let cancelled = false;
    resolveEvidenceUrl(path)
      .then((signedUrl) => {
        if (!cancelled) setResolved({ path, url: signedUrl });
      })
      .catch((err) => {
        console.error("Failed to resolve evidence URL:", err);
        if (!cancelled) setResolved({ path, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [path, isLegacy]);

  const url = isLegacy ? path : (resolved.path === path ? resolved.url : null);

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
            className={cn("absolute inset-0 w-full h-full object-cover", imgClassName)}
          />
        ) : (
          <Image
            src={url}
            alt={alt}
            fill
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
      controls
      playsInline
      className={cn("select-none", className, videoClassName)}
      style={{ WebkitTouchCallout: "none" }}
    />
  );
}
