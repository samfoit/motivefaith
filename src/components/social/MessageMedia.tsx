"use client";

import { EvidenceMedia } from "@/components/ui/EvidenceMedia";

/**
 * A photo or video sent from the capture flow, inside a DM or group message
 * bubble. The path is in the private `completions` bucket; the recipient can
 * resolve it because the message row references it (migration 034).
 */
export function MessageMedia({
  path,
  type,
}: {
  path: string;
  type: "photo" | "video";
}) {
  return (
    <EvidenceMedia
      path={path}
      type={type}
      alt="Shared photo"
      className="w-56 max-w-full rounded-lg overflow-hidden bg-[var(--color-bg-secondary)]"
      videoClassName="max-h-72"
    />
  );
}
