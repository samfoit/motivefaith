"use client";

import { useState } from "react";
import { EvidenceAudio } from "@/components/ui/EvidenceAudio";
import { EvidenceMedia } from "@/components/ui/EvidenceMedia";
import { MediaLightbox } from "@/components/ui/MediaLightbox";

const FRAME_CLASS =
  "w-56 max-w-full rounded-lg overflow-hidden bg-[var(--color-bg-secondary)]";

/**
 * A photo, video or voice note sent from the capture flow, inside a DM or
 * group message bubble. The path is in the private `completions` bucket; the
 * recipient can resolve it because the message row references it (034, 035).
 *
 * A photo opens full size on tap, the same way a check-in photo does; a video
 * plays in place with its own controls, and so does a voice note.
 */
export function MessageMedia({
  path,
  type,
}: {
  path: string;
  type: "photo" | "video" | "voice";
}) {
  const [open, setOpen] = useState(false);

  if (type === "voice") {
    return <EvidenceAudio path={path} />;
  }

  if (type === "video") {
    return (
      <EvidenceMedia
        path={path}
        type="video"
        className={FRAME_CLASS}
        videoClassName="max-h-72"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View photo"
        className="block cursor-zoom-in"
      >
        <EvidenceMedia path={path} type="photo" alt="Shared photo" className={FRAME_CLASS} />
      </button>
      <MediaLightbox path={path} open={open} onOpenChange={setOpen} alt="Shared photo" />
    </>
  );
}
