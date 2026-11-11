/**
 * Removing queued files from storage (migration 056).
 *
 * Deleting a habit, a group, an account or a reported check-in leaves its
 * photos, videos and voice notes behind: Postgres cannot remove a stored
 * file. Each such delete writes the path to media_purge_queue instead, and
 * this takes them off it, a batch at a time:
 *
 *   claim_media_purge   the oldest entries that are due, marked as tried. An
 *                       entry some row points at again is dropped there, not
 *                       returned.
 *   storage remove      by exact path. A file already gone is not an error.
 *   finish_media_purge  the entries whose files went.
 *
 * An entry whose removal fails stays queued and comes round again in ten
 * minutes.
 *
 * No imports, so the test suite can load it outside Deno; the client is
 * whatever has these two methods.
 */

interface Failure {
  message: string;
}

export interface PurgeClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: Failure | null }>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ data: unknown; error: Failure | null }>;
    };
  };
}

export interface PurgeResult {
  /** Files removed (or already gone) and taken off the queue. */
  removed: number;
  /** Entries still queued after a failed attempt. */
  failed: number;
}

interface QueuedFile {
  bucket: string;
  path: string;
}

function isQueuedFile(value: unknown): value is QueuedFile {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.bucket === "string" && typeof row.path === "string";
}

export async function purgeQueuedMedia(
  client: PurgeClient,
  { batchSize = 100, maxBatches = 20 }: { batchSize?: number; maxBatches?: number } = {},
): Promise<PurgeResult> {
  const result: PurgeResult = { removed: 0, failed: 0 };

  for (let batch = 0; batch < maxBatches; batch++) {
    const claimed = await client.rpc("claim_media_purge", { p_limit: batchSize });
    if (claimed.error) throw new Error(`claim_media_purge: ${claimed.error.message}`);

    const files = (Array.isArray(claimed.data) ? claimed.data : []).filter(isQueuedFile);
    if (files.length === 0) break;

    const byBucket = new Map<string, string[]>();
    for (const file of files) {
      byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
    }

    for (const [bucket, paths] of byBucket) {
      const removal = await client.storage.from(bucket).remove(paths);
      if (removal.error) {
        console.error(`purge-media: removing ${paths.length} from ${bucket} failed: ${removal.error.message}`);
        result.failed += paths.length;
        continue;
      }

      const finished = await client.rpc("finish_media_purge", { p_bucket: bucket, p_paths: paths });
      if (finished.error) {
        // The files are gone; the entries stay and the next try finds nothing to remove.
        console.error(`purge-media: finish_media_purge for ${bucket} failed: ${finished.error.message}`);
        result.failed += paths.length;
        continue;
      }
      result.removed += paths.length;
    }

    if (files.length < batchSize) break;
  }

  return result;
}
