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
  resolvers: Map<
    string,
    Array<{ resolve: (url: string | null) => void; reject: (err: unknown) => void }>
  >;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

function flushBatch(): void {
  const batch = pendingBatch;
  pendingBatch = null;
  if (!batch || batch.paths.length === 0) return;

  const fail = (err: unknown) => {
    for (const callbacks of batch.resolvers.values()) {
      for (const { reject } of callbacks) reject(err);
    }
  };

  const supabase = createClient();
  supabase.storage
    .from(BUCKET)
    .createSignedUrls(batch.paths, SIGNED_URL_TTL)
    .then(({ data, error }) => {
      // The request itself failed: nothing is known about any file in it.
      if (error || !data) {
        fail(error ?? new Error("No signed URLs returned"));
        return;
      }
      for (const item of data) {
        if (item.signedUrl && item.path) {
          cacheSet(item.path, item.signedUrl, Date.now() + SIGNED_URL_TTL * 1000);
          for (const { resolve } of batch.resolvers.get(item.path) ?? []) {
            resolve(item.signedUrl);
          }
          batch.resolvers.delete(item.path);
        }
      }
      // Storage answered, and had nothing for these: missing or not ours to read.
      for (const callbacks of batch.resolvers.values()) {
        for (const { resolve } of callbacks) resolve(null);
      }
    })
    .catch((err) => {
      console.error("Failed to resolve evidence URLs:", err);
      fail(err);
    });
}

/**
 * Resolve a single evidence path to a signed URL.
 *
 * Resolves to `null` when Storage answers that there is no file this person
 * may read: it was removed, or whatever shared it is gone (059). Rejects when
 * Storage could not be asked at all (offline, a failed request), which says
 * nothing about the file and is worth trying again.
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

  return new Promise<string | null>((resolve, reject) => {
    if (!pendingBatch) {
      pendingBatch = { paths: [], resolvers: new Map(), timer: null };
    }

    // Add the path to the batch (deduplicate)
    const existing = pendingBatch.resolvers.get(path);
    if (existing) {
      existing.push({ resolve, reject });
    } else {
      pendingBatch.paths.push(path);
      pendingBatch.resolvers.set(path, [{ resolve, reject }]);
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
