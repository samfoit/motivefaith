import { jsonResponse, requireAuthUser } from "@/lib/utils/api-helpers";
import { BlockedUrlError, checkUrl, getLinkPreview } from "@/lib/link-preview/fetch";

/**
 * The preview for a link in a chat: GET /api/link-preview?url=…
 *
 * Answers `{ preview: null }` when there's nothing to show (no title and no
 * picture, a page that failed, an address that may not be fetched), so the
 * link stays a plain link. The picture is never handed out as the site's own
 * address: the CSP wouldn't load it, and loading it would tell the site who
 * is reading. It is fetched through /api/link-preview/image instead.
 *
 * Signed in only, so the server isn't a free fetcher for anyone. No CSRF
 * check: a GET with no side effects, and the SameSite=Lax cookie isn't sent
 * on a cross-site one. Cached privately in the browser for a day; the service
 * worker leaves /api/* alone.
 */

const MAX_URL_LENGTH = 2048;

export async function GET(request: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url).searchParams.get("url");
  if (!url || url.length > MAX_URL_LENGTH) {
    return jsonResponse({ error: "url is required" }, { status: 400 });
  }
  try {
    checkUrl(url);
  } catch (err) {
    if (err instanceof BlockedUrlError) return jsonResponse({ preview: null });
    throw err;
  }

  const preview = await getLinkPreview(url);
  const cacheControl = { "Cache-Control": "private, max-age=86400" };
  if (!preview) {
    return jsonResponse({ preview: null }, { headers: { "Cache-Control": "private, max-age=1800" } });
  }

  const { image, ...rest } = preview;
  return jsonResponse(
    {
      preview: {
        ...rest,
        image: image ? `/api/link-preview/image?url=${encodeURIComponent(preview.url)}` : null,
      },
    },
    { headers: cacheControl },
  );
}
