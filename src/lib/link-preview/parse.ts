/**
 * Reading a page's preview out of its HTML: the OpenGraph and Twitter card
 * tags sites write for exactly this, falling back to <title> and the plain
 * description.
 *
 * Regexes, not a DOM: only the <head> is read, and a parser library would be
 * a large server dependency for a handful of tags. Anything unusual simply
 * yields less — a preview with no title and no image isn't shown at all.
 */

export type ParsedPreview = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Absolute http(s) URL of the page's picture. */
  image: string | null;
  /** The site asks for a wide picture under the text, not a thumbnail beside it. */
  largeImage: boolean;
};

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;
const MAX_SITE_NAME = 80;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function clean(raw: string | undefined, max: number): string | null {
  if (!raw) return null;
  // Twice: plenty of sites escape their tags' text twice ("&amp;#039;"). This
  // is shown as text, never as HTML, so over-decoding can't hurt.
  const text = decodeEntities(decodeEntities(raw)).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR_RE)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** The page's own address for its picture, made absolute; only http(s). */
function absoluteHttpUrl(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeEntities(raw.trim()), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function parsePreview(html: string, pageUrl: string): ParsedPreview {
  const headEnd = html.search(/<\/head>|<body[\s>]/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);

  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(m[0]);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase();
    const content = attrs.content;
    // The first wins: sites list their main picture first.
    if (key && content !== undefined && !(key in meta)) meta[key] = content;
  }

  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  const image =
    absoluteHttpUrl(meta["og:image:secure_url"], pageUrl) ??
    absoluteHttpUrl(meta["og:image"], pageUrl) ??
    absoluteHttpUrl(meta["og:image:url"], pageUrl) ??
    absoluteHttpUrl(meta["twitter:image"], pageUrl) ??
    absoluteHttpUrl(meta["twitter:image:src"], pageUrl);

  const card = meta["twitter:card"]?.toLowerCase();
  const width = parseInt(meta["og:image:width"] ?? "", 10);
  const height = parseInt(meta["og:image:height"] ?? "", 10);
  const squarish = width > 0 && height > 0 && width / height < 1.3;
  // A "summary" card is a thumbnail; so is a small or squarish picture. A
  // wide one, or one the site gives no hint about, goes full width.
  const largeImage =
    card === "summary" ? false
    : card === "summary_large_image" || card === "player" ? true
    : !(squarish || (width > 0 && width < 400));

  return {
    title: clean(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, MAX_TITLE),
    description: clean(
      meta["og:description"] ?? meta["twitter:description"] ?? meta["description"],
      MAX_DESCRIPTION,
    ),
    siteName: clean(meta["og:site_name"] ?? meta["application-name"], MAX_SITE_NAME),
    image,
    largeImage,
  };
}

/** The charset a page declares in its <meta>, for when the header doesn't say. */
export function declaredCharset(htmlStart: string): string | null {
  const m =
    htmlStart.match(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i);
  return m ? m[1].toLowerCase() : null;
}
