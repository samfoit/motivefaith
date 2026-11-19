"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { useNearViewport } from "@/lib/hooks/useNearViewport";
import { linkify } from "@/lib/utils/linkify";

/**
 * Links in a chat: tappable in the text, and the first one previewed under
 * its message with the page's title, description and picture — what the page
 * itself says it should look like when shared.
 */

// ---------------------------------------------------------------------------
// Tappable links in text
// ---------------------------------------------------------------------------

const LINK_CLASS =
  // No break-all: the bubble's break-words splits a link only when it can't
  // fit on a line of its own, rather than mid-word wherever a line ends.
  "text-brand-ink underline underline-offset-2 decoration-1 hover:decoration-2";

/** The text, with each link in it something to tap. */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((segment, i) =>
        segment.kind === "text" ? (
          segment.text
        ) : (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className={LINK_CLASS}
          >
            {segment.text}
          </a>
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

export type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Our own /api/link-preview/image address, never the site's. */
  image: string | null;
  largeImage: boolean;
};

export function linkPreviewKey(url: string) {
  return ["link-preview", url] as const;
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Link preview failed: ${res.status}`);
  const body = (await res.json()) as { preview: LinkPreviewData | null };
  return body.preview;
}

/**
 * Keeps the end of the thread in view when `grown` has just taken its space.
 * A preview arrives after the thread has opened at its newest message; without
 * this the last message would end up behind the composer. The reader was at
 * the end if they're now no further from it than the new element is tall.
 */
function stayAtBottom(grown: HTMLElement | null) {
  if (!grown) return;
  const doc = document.documentElement;
  const fromBottom = doc.scrollHeight - (window.innerHeight + window.scrollY);
  if (fromBottom > 0 && fromBottom <= grown.offsetHeight + 24) {
    window.scrollTo({ top: doc.scrollHeight });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The card for a link: site, title, a few lines of description, and the
 * picture — wide under the text, or a thumbnail beside it when the site asks
 * for a small one. Fetched only once it's near the screen; shows nothing if
 * the page has nothing to show, so the link stays a plain link.
 */
export function LinkPreviewCard({ url, className }: { url: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const [imageFailed, setImageFailed] = useState(false);

  const { data: preview } = useQuery({
    queryKey: linkPreviewKey(url),
    queryFn: () => fetchLinkPreview(url),
    enabled: near,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const hasPreview = !!preview;
  useLayoutEffect(() => {
    if (hasPreview) stayAtBottom(ref.current);
  }, [hasPreview]);

  if (!preview) return <div ref={ref} aria-hidden />;

  const image = preview.image && !imageFailed ? preview.image : null;
  const thumbnail = image && !preview.largeImage;
  const site = preview.siteName ?? hostOf(preview.url);

  return (
    <div ref={ref} className={cn("w-72 max-w-full", className)}>
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className={cn(
          "block overflow-hidden rounded-2xl border border-border bg-bg-elevated",
          "border-l-[3px] border-l-brand transition-colors hover:bg-surface-hover",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink",
        )}
      >
        <div className="flex gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-text-tertiary">{site}</p>
            {preview.title && (
              <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-brand-ink">
                {preview.title}
              </p>
            )}
            {preview.description && (
              <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-text-secondary">
                {preview.description}
              </p>
            )}
          </div>
          {thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element -- served by our own preview route, already sized by the site
            <img
              src={image}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-16 w-16 shrink-0 rounded-lg object-cover bg-bg-secondary"
            />
          )}
        </div>
        {image && !thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element -- served by our own preview route, already sized by the site
          <img
            src={image}
            alt=""
            loading="lazy"
            onLoad={(e) => stayAtBottom(e.currentTarget)}
            onError={() => setImageFailed(true)}
            className="block max-h-72 w-full object-cover bg-bg-secondary"
          />
        )}
      </a>
    </div>
  );
}
