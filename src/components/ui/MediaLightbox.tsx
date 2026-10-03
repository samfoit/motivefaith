"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { EvidenceMedia } from "@/components/ui/EvidenceMedia";

interface MediaLightboxProps {
  /** Storage path (or legacy URL) of the photo, as EvidenceMedia takes it. */
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alt?: string;
}

/**
 * A photo shown full size, over everything.
 *
 * Portalled to the body: chat bubbles animate in with transforms, and a
 * transformed ancestor turns `position: fixed` into "fixed to the bubble".
 * The photo's box is given the stage's full size and the image is contained
 * within it — EvidenceMedia's own box is sized by an aspect ratio, which with
 * no width to resolve against collapses to nothing.
 */
export function MediaLightbox({
  path,
  open,
  onOpenChange,
  alt = "Photo",
}: MediaLightboxProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/85" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
          // A tap on the dark area around the photo closes it, as before.
          onClick={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
        >
          <RadixDialog.Title className="sr-only">{alt}</RadixDialog.Title>
          <RadixDialog.Close
            className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </RadixDialog.Close>
          <div className="w-full h-full max-w-5xl">
            <EvidenceMedia
              path={path}
              type="photo"
              alt={alt}
              className="w-full h-full"
              imgClassName="object-contain"
            />
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
