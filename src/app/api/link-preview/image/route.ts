import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/utils/api-helpers";
import {
  BlockedUrlError,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  checkUrl,
  getLinkPreview,
  guardedGet,
} from "@/lib/link-preview/fetch";

/**
 * A link preview's picture, fetched by the server: GET /api/link-preview/image?url=…
 *
 * `url` is the page, not the picture. Only the picture that page names is
 * ever fetched, so this can't be pointed at any image on the internet.
 *
 * Raster formats only, and sandboxed: the bytes come from someone else's
 * server but are served from ours, so an SVG (which can run script) or a page
 * dressed as an image must never render as a document here.
 */

const MAX_URL_LENGTH = 2048;

function notFound() {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "private, max-age=1800" },
  });
}

export async function GET(request: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url).searchParams.get("url");
  if (!url || url.length > MAX_URL_LENGTH) return notFound();
  try {
    checkUrl(url);
  } catch (err) {
    if (err instanceof BlockedUrlError) return notFound();
    throw err;
  }

  const preview = await getLinkPreview(url);
  if (!preview?.image) return notFound();

  try {
    const res = await guardedGet(preview.image, "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9");
    if (!IMAGE_TYPES.has(res.contentType)) {
      res.discard();
      return notFound();
    }
    const { body, truncated } = await res.read(MAX_IMAGE_BYTES);
    if (truncated) return notFound();

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": res.contentType,
        "Content-Length": String(body.length),
        "Cache-Control": "private, max-age=86400",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (!(err instanceof BlockedUrlError)) {
      console.warn("[link-preview] image failed:", err instanceof Error ? err.message : err);
    }
    return notFound();
  }
}
