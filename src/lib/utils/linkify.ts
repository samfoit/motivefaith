/**
 * Finding the links in a chat message, so they can be tapped and previewed.
 *
 * A link is anything starting `http://`, `https://` or `www.`, the way people
 * paste them. A bare `example.com` stays text: too many ordinary sentences
 * ("I read Acts 2.1" with a typo, "node.js") would turn blue otherwise.
 *
 * Punctuation that ends a sentence isn't part of the link ("see
 * https://x.com/a." links `https://x.com/a`), and neither is a closing
 * bracket the link didn't open ("(https://en.wikipedia.org/wiki/Foo_(bar))"
 * keeps its own pair and drops the outer one).
 */

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

const TRAILING_PUNCTUATION = /[.,;:!?'"*_~]+$/;

const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Drops punctuation and unopened closing brackets from the end. */
function trimEnd(raw: string): string {
  let s = raw;
  for (;;) {
    const before = s;
    s = s.replace(TRAILING_PUNCTUATION, "");
    const last = s.at(-1);
    if (last && PAIRS[last]) {
      const open = PAIRS[last];
      const opens = s.split(open).length - 1;
      const closes = s.split(last).length - 1;
      if (closes > opens) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

/** The address to open: a `www.` link gets https. Null if it isn't a usable URL. */
export function normalizeHref(text: string): string | null {
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    const linkText = trimEnd(match[0]);
    const href = normalizeHref(linkText);
    if (!href || linkText.length === 0) continue;

    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });
    segments.push({ kind: "link", text: linkText, href });
    cursor = start + linkText.length;
  }

  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/** The first link in the text, the one a preview is shown for. */
export function firstLink(text: string): string | null {
  for (const segment of linkify(text)) {
    if (segment.kind === "link") return segment.href;
  }
  return null;
}
