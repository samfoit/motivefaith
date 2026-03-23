import React, { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils/cn";

type Size = "sm" | "md" | "lg";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  name?: string | null;
  size?: Size;
  online?: boolean;
  alt?: string;
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: "w-8 h-8 text-sm",
  md: "w-12 h-12 text-base",
  lg: "w-16 h-16 text-lg",
};

const SIZE_PX: Record<Size, number> = { sm: 32, md: 48, lg: 64 };

/** Only render images from trusted origins. */
function isTrustedImageSrc(src: string): boolean {
  // Data URLs from local previews are trusted
  if (src.startsWith("data:")) return true;
  // Relative URLs are same-origin
  if (src.startsWith("/")) return true;
  try {
    const url = new URL(src);
    return (
      url.hostname.endsWith(".supabase.co") ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost"
    );
  } catch {
    return false;
  }
}

function getInitials(name?: string | null) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  const initials =
    parts.length === 1
      ? parts[0].slice(0, 2)
      : (parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "");
  return initials.toUpperCase();
}

function Fallback({ emoji, name }: { emoji: string | null; name?: string | null }) {
  return (
    <span className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-800 font-medium">
      {emoji || getInitials(name)}
    </span>
  );
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  (
    { src, name, size = "md", online = false, className, alt, ...props },
    ref,
  ) => {
    const isEmoji = src?.startsWith("emoji:") ?? false;
    const emoji = isEmoji && src ? src.slice(6) : null;
    const imageSrc = src && !isEmoji && isTrustedImageSrc(src) ? src : null;
    const isUnoptimized = imageSrc?.startsWith("data:") || imageSrc?.includes("://127.0.0.1") || imageSrc?.includes("://localhost");
    const [imgError, setImgError] = useState(false);
    const px = SIZE_PX[size];

    return (
      <div
        ref={ref}
        className={cn(
          "relative inline-block rounded-full overflow-hidden bg-gray-100",
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {imageSrc && !imgError ? (
          isUnoptimized ? (
            /* Data URLs and localhost can't be optimized by next/image */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt={alt ?? name ?? "avatar"}
              className="w-full h-full object-cover block"
              onError={() => setImgError(true)}
            />
          ) : (
            <Image
              src={imageSrc}
              alt={alt ?? name ?? "avatar"}
              width={px}
              height={px}
              sizes={`${px}px`}
              className="w-full h-full object-cover block"
              onError={() => setImgError(true)}
            />
          )
        ) : (
          <Fallback emoji={emoji} name={name} />
        )}

        {online && (
          <span
            aria-hidden
            className={cn(
              "absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 rounded-full ring-2 ring-white",
              size === "sm"
                ? "w-2.5 h-2.5"
                : size === "md"
                  ? "w-3.5 h-3.5"
                  : "w-4 h-4",
              "bg-green-400",
            )}
          />
        )}
      </div>
    );
  },
);

Avatar.displayName = "Avatar";

export default Avatar;
