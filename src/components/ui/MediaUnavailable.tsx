import { CloudOff, ImageOff, MicOff, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const GONE = {
  photo: { Icon: ImageOff, text: "Photo no longer available" },
  video: { Icon: VideoOff, text: "Video no longer available" },
  voice: { Icon: MicOff, text: "Voice note no longer available" },
} as const;

/**
 * What a check-in or message shows in place of media it cannot show. The
 * check-in itself still happened, so its frame keeps its place in the
 * history and says plainly what is missing: no endless shimmer, no broken
 * image icon.
 *
 * `gone` is for good; `failed` is a connection problem, retried on its own
 * when the device is back online.
 */
export function MediaUnavailable({
  type,
  reason,
  className,
}: {
  type: "photo" | "video" | "voice";
  reason: "gone" | "failed";
  className?: string;
}) {
  const { Icon, text } =
    reason === "failed" ? { Icon: CloudOff, text: "Can't load right now" } : GONE[type];

  if (type === "voice") {
    return (
      <div
        role="note"
        className={cn(
          "inline-flex h-9 w-56 max-w-full items-center gap-2 rounded-full px-3",
          "bg-bg-secondary text-xs text-text-tertiary",
          className,
        )}
      >
        <Icon aria-hidden className="w-4 h-4 shrink-0" />
        <span className="truncate">{text}</span>
      </div>
    );
  }

  return (
    <div
      role="note"
      className={cn(
        "flex min-h-32 flex-col items-center justify-center gap-1.5 p-4",
        "bg-bg-secondary text-xs text-text-tertiary text-center",
        className,
      )}
    >
      <Icon aria-hidden className="w-5 h-5" />
      <span>{text}</span>
    </div>
  );
}
