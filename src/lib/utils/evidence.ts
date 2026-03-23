/**
 * Evidence URL resolution utilities.
 *
 * Completion evidence is stored in a private Supabase Storage bucket.
 * The `evidence_url` column stores the **storage path** (e.g.
 * `userId/habitId/1234567890.webp`). At render time we resolve paths
 * to short-lived signed URLs (1 hour).
 *
 * Legacy rows may contain full signed URLs (starting with `http`).
 * These are passed through as-is — they will expire after their
 * original 7-day window, at which point evidence becomes inaccessible
 * unless the row is migrated.
 */

import { createClient } from "@/lib/supabase/client";

const SIGNED_URL_TTL = 60 * 60; // 1 hour
const BUCKET = "completions";

/** In-memory cache: path → { url, expiresAt }. Max 200 entries with LRU eviction. */
const MAX_CACHE_SIZE = 200;
const cache = new Map<string, { url: string; expiresAt: number }>();

/** Buffer before expiry to refresh proactively (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function cacheSet(path: string, url: string, expiresAt: number): void {
  // Delete first to ensure the key moves to the end (most recent) on re-insert
  cache.delete(path);
  if (cache.size >= MAX_CACHE_SIZE) {
    // Evict the oldest entry (first key in insertion order)
    const oldest = cache.keys().next().value;
    if (oldest != null) cache.delete(oldest);
  }
  cache.set(path, { url, expiresAt });
}

/** Extract the hostname of our own Supabase instance from the env var. */
const OWN_SUPABASE_HOST = (() => {
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return raw ? new URL(raw).hostname : null;
  } catch {
    return null;
  }
})();

function isLegacyUrl(value: string): boolean {
  if (!value.startsWith("https://") && !value.startsWith("http://")) return false;
  try {
    const url = new URL(value);
    // Only trust URLs from our own Supabase storage or localhost dev
    return (
      (OWN_SUPABASE_HOST !== null && url.hostname === OWN_SUPABASE_HOST) ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost"
    );
  } catch {
    return false;
  }
}

function getCached(path: string): string | null {
  const entry = cache.get(path);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt - REFRESH_BUFFER_MS) {
    cache.delete(path);
    return null;
  }
  // Touch: move to end for LRU ordering
  cache.delete(path);
  cache.set(path, entry);
  return entry.url;
}

/**
 * Microbatch: collects concurrent resolveEvidenceUrl calls within a
 * short window and resolves them in a single createSignedUrls request.
 * This prevents 20+ individual API calls when a feed mounts.
 */
const BATCH_DELAY_MS = 50;
let pendingBatch: {
  paths: string[];
  resolvers: Map<string, Array<(url: string | null) => void>>;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

function flushBatch(): void {
  const batch = pendingBatch;
  pendingBatch = null;
  if (!batch || batch.paths.length === 0) return;

  const supabase = createClient();
  supabase.storage
    .from(BUCKET)
    .createSignedUrls(batch.paths, SIGNED_URL_TTL)
    .then(({ data, error }) => {
      if (!error && data) {
        for (const item of data) {
          if (item.signedUrl && item.path) {
            cacheSet(item.path, item.signedUrl, Date.now() + SIGNED_URL_TTL * 1000);
            const callbacks = batch.resolvers.get(item.path);
            if (callbacks) {
              for (const cb of callbacks) cb(item.signedUrl);
            }
            batch.resolvers.delete(item.path);
          }
        }
      }
      // Resolve any remaining paths (failed/missing) with null
      for (const callbacks of batch.resolvers.values()) {
        for (const cb of callbacks) cb(null);
      }
    })
    .catch((err) => {
      console.error("Failed to resolve evidence URLs:", err);
      for (const callbacks of batch.resolvers.values()) {
        for (const cb of callbacks) cb(null);
      }
    });
}

/**
 * Resolve a single evidence path to a signed URL.
 * Returns the signed URL or `null` on failure.
 *
 * Concurrent calls within 50ms are automatically batched into a
 * single `createSignedUrls` request to avoid N+1 API calls.
 */
export async function resolveEvidenceUrl(
  path: string,
): Promise<string | null> {
  if (!path) return null;
  if (isLegacyUrl(path)) return path;

  const cached = getCached(path);
  if (cached) return cached;

  return new Promise<string | null>((resolve) => {
    if (!pendingBatch) {
      pendingBatch = { paths: [], resolvers: new Map(), timer: null };
    }

    // Add the path to the batch (deduplicate)
    const existing = pendingBatch.resolvers.get(path);
    if (existing) {
      existing.push(resolve);
    } else {
      pendingBatch.paths.push(path);
      pendingBatch.resolvers.set(path, [resolve]);
    }

    // Reset the timer to flush after BATCH_DELAY_MS of inactivity
    if (pendingBatch.timer) clearTimeout(pendingBatch.timer);
    pendingBatch.timer = setTimeout(flushBatch, BATCH_DELAY_MS);
  });
}

/**
 * Batch-resolve multiple evidence paths to signed URLs.
 * Returns a Map from original path → signed URL.
 * Legacy URLs are passed through. Failed resolutions are omitted.
 */
export async function resolveEvidenceUrls(
  paths: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toResolve: string[] = [];

  for (const path of paths) {
    if (!path) continue;

    if (isLegacyUrl(path)) {
      result.set(path, path);
      continue;
    }

    const cached = getCached(path);
    if (cached) {
      result.set(path, cached);
    } else {
      toResolve.push(path);
    }
  }

  if (toResolve.length === 0) return result;

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(toResolve, SIGNED_URL_TTL);

  if (!error && data) {
    for (const item of data) {
      if (item.signedUrl && item.path) {
        cacheSet(item.path, item.signedUrl, Date.now() + SIGNED_URL_TTL * 1000);
        result.set(item.path, item.signedUrl);
      }
    }
  }

  return result;
}
