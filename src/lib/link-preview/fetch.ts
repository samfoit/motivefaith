import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { declaredCharset, parsePreview, type ParsedPreview } from "./parse";

/**
 * Fetching a link's preview on the server, for any address a friend pastes.
 *
 * Done here rather than in the browser for two reasons: a page's tags can't
 * be read cross-origin, and the site would otherwise see the IP address of
 * everyone in the chat who scrolls past the link.
 *
 * The danger in fetching any address someone types is the server's own
 * network: `http://169.254.169.254/` or a name that resolves to 10.0.0.5.
 * So every address is checked where the connection is made — the DNS lookup
 * itself refuses private ones — which also holds for each redirect, and for a
 * name that resolves differently the second time it is asked.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; MotiveFaithBot/1.0; +link preview)";
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
/**
 * Enough for any <head>: YouTube's runs to about 800 KB of inline script
 * before its tags. Reading stops at </head>, so most pages cost a few KB.
 */
const MAX_HTML_BYTES = 1536 * 1024;
const HEAD_END = Buffer.from("</head>");
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Raster formats only. SVG can carry script, and it is served from our origin. */
export const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

// ---------------------------------------------------------------------------
// Which addresses may be reached
// ---------------------------------------------------------------------------

// Two lists: a BlockList counts an IPv4 address and its IPv4-mapped IPv6
// form as one, so blocking ::ffff:0:0/96 alongside the IPv4 ranges would
// block every IPv4 address.
const blockedV4 = new net.BlockList();
const blockedV6 = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96], // IPv4-mapped: would reach any IPv4 address
  ["64:ff9b::", 96], // NAT64: likewise
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blockedV4.check(address, "ipv4");
  if (family === 6) return blockedV6.check(address, "ipv6");
  return true;
}

export class BlockedUrlError extends Error {}

/** Http(s) on the usual ports, with a name or a public address. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("Not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Not http(s)");
  }
  if (url.username || url.password) throw new BlockedUrlError("Credentials in URL");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new BlockedUrlError("Unusual port");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // An address written out is connected to without a lookup, so it is
  // checked here; a name is checked by the lookup below.
  if (net.isIP(host) && isBlockedAddress(host)) throw new BlockedUrlError("Private address");
  if (!net.isIP(host) && !host.includes(".")) throw new BlockedUrlError("Not a public name");
  return url;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/** dns.lookup, refusing to hand back a private address. */
function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const safe = addresses.filter((a) => !isBlockedAddress(a.address));
    if (safe.length === 0 || safe.length !== addresses.length) {
      const error: NodeJS.ErrnoException = new BlockedUrlError(`${hostname} resolves to a private address`);
      error.code = "EBLOCKED";
      return callback(error, []);
    }
    if (options.all) return callback(null, safe);
    callback(null, safe[0].address, safe[0].family);
  });
}

// ---------------------------------------------------------------------------
// One guarded GET, following redirects
// ---------------------------------------------------------------------------

export type GuardedResponse = {
  /** Where the redirects ended. */
  url: string;
  /** The media type alone, lowercased: "text/html". */
  contentType: string;
  charset: string | null;
  /**
   * The body, or the first `maxBytes` of it. `truncated` if there was more.
   * With `until`, stops once those bytes have arrived (lowercase, matched as
   * sent — `</head>` is written that way by nearly every page).
   */
  read: (maxBytes: number, until?: Buffer) => Promise<{ body: Buffer; truncated: boolean }>;
  /** Closes the connection without reading. */
  discard: () => void;
};

export function requestOnce(url: URL, accept: string, signal: AbortSignal): Promise<http.IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      {
        lookup: guardedLookup as unknown as net.LookupFunction,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en",
        },
        signal,
        agent: false,
      },
      resolve,
    );
    req.on("error", reject);
  });
}

function decoded(res: http.IncomingMessage): Readable {
  switch ((res.headers["content-encoding"] ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return res.pipe(zlib.createGunzip());
    case "deflate":
      return res.pipe(zlib.createInflate());
    case "br":
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
}

export async function readLimited(
  stream: Readable,
  source: http.IncomingMessage,
  maxBytes: number,
  until?: Buffer,
): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tail = Buffer.alloc(0);
  const stop = () => {
    source.destroy();
    stream.destroy();
    return { body: Buffer.concat(chunks, size), truncated: true };
  };
  try {
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      if (size + buf.length > maxBytes) {
        chunks.push(buf.subarray(0, maxBytes - size));
        size = maxBytes;
        return stop();
      }
      chunks.push(buf);
      size += buf.length;
      if (until) {
        // The marker can straddle two chunks, so look across the seam.
        const seam = Buffer.concat([tail, buf]);
        if (seam.includes(until)) return stop();
        tail = seam.subarray(Math.max(0, seam.length - until.length + 1));
      }
    }
  } catch (err) {
    // Cut off after something arrived (a truncated gzip stream, say): what
    // came is still usable for a <head>.
    if (size === 0) throw err;
    return { body: Buffer.concat(chunks, size), truncated: true };
  }
  return { body: Buffer.concat(chunks, size), truncated: false };
}

export async function guardedGet(
  raw: string,
  accept: string,
  signal: AbortSignal = AbortSignal.timeout(TIMEOUT_MS),
): Promise<GuardedResponse> {
  let url = checkUrl(raw);

  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, accept, signal);
    const status = res.statusCode ?? 0;

    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      url = checkUrl(new URL(res.headers.location, url).href);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      throw new Error(`HTTP ${status}`);
    }

    const [type, ...params] = (res.headers["content-type"] ?? "").split(";");
    const charset = params
      .map((p) => p.trim().match(/^charset\s*=\s*"?([\w-]+)"?$/i)?.[1] ?? null)
      .find((c) => c !== null) ?? null;

    const finalUrl = url.href;
    return {
      url: finalUrl,
      contentType: type.trim().toLowerCase(),
      charset: charset?.toLowerCase() ?? null,
      read: (maxBytes, until) => readLimited(decoded(res), res, maxBytes, until),
      discard: () => res.destroy(),
    };
  }
}

// ---------------------------------------------------------------------------
// A link's preview, cached
// ---------------------------------------------------------------------------

export type LinkPreview = ParsedPreview & {
  /** The address that was asked about. */
  url: string;
};

function decodeHtml(body: Buffer, headerCharset: string | null): string {
  const charset =
    headerCharset ?? declaredCharset(body.subarray(0, 2048).toString("latin1")) ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

async function loadPreview(url: string): Promise<LinkPreview | null> {
  const res = await guardedGet(url, "text/html,application/xhtml+xml;q=0.9,image/*;q=0.8,*/*;q=0.1");

  // A link straight to a picture previews as the picture.
  if (IMAGE_TYPES.has(res.contentType)) {
    res.discard();
    return {
      url,
      title: null,
      description: null,
      siteName: null,
      image: res.url,
      largeImage: true,
    };
  }

  if (res.contentType !== "text/html" && res.contentType !== "application/xhtml+xml") {
    res.discard();
    return null;
  }

  const { body } = await res.read(MAX_HTML_BYTES, HEAD_END);
  const parsed = parsePreview(decodeHtml(body, res.charset), res.url);
  if (!parsed.title && !parsed.image) return null;
  return { url, ...parsed };
}

const PREVIEW_TTL_MS = 6 * 60 * 60 * 1000;
/** A page that had nothing, or failed, is asked again sooner. */
const EMPTY_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED = 500;

type CacheEntry = { at: number; ttl: number; value: Promise<LinkPreview | null> };

/**
 * Per server instance. The browser caches the answer too, so this mostly
 * saves a page being fetched once per person in a busy group, and lets the
 * image route find the picture without fetching the page again.
 */
const cache = new Map<string, CacheEntry>();

/** The cache key: the address without its #fragment, which no server sees. */
export function previewKey(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  return url.href;
}

export function getLinkPreview(raw: string): Promise<LinkPreview | null> {
  const key = previewKey(raw);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value;

  const entry: CacheEntry = { at: now, ttl: PREVIEW_TTL_MS, value: Promise.resolve(null) };
  entry.value = loadPreview(key).then(
    (preview) => {
      if (!preview) entry.ttl = EMPTY_TTL_MS;
      return preview;
    },
    (err: unknown) => {
      entry.ttl = EMPTY_TTL_MS;
      if (!(err instanceof BlockedUrlError)) {
        console.warn("[link-preview] fetch failed:", err instanceof Error ? err.message : err);
      }
      return null;
    },
  );

  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return entry.value;
}

/** For tests. */
export function clearLinkPreviewCache() {
  cache.clear();
}
