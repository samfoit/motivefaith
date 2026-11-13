/**
 * Removing files from storage, for the two places the server does it itself
 * rather than leaving it to the purge queue (migration 056): deleting an
 * account, and a moderator taking content down.
 *
 * Storage's `remove` deletes exactly the paths it is given. A folder is not a
 * path — handing it one removes nothing and reports no error, which is how
 * account deletion left every check-in photo behind: it listed the user's
 * folder, got back the folders inside, and "removed" those.
 */

interface Failure {
  message: string;
}

interface StorageEntry {
  name: string;
  /** `null` for a folder; a file has its object id. */
  id: string | null;
}

export interface StorageLike {
  from(bucket: string): {
    list(
      path: string,
      options: { limit: number; offset: number; sortBy: { column: string; order: string } },
    ): PromiseLike<{ data: StorageEntry[] | null; error: Failure | null }>;
    remove(paths: string[]): PromiseLike<{ data: unknown; error: Failure | null }>;
  };
}

/** Entries per listing request. A folder with more is read a page at a time. */
const LIST_PAGE = 1000;

/** Paths per removal request. */
const REMOVE_BATCH = 100;

/**
 * The path in the `completions` bucket that a stored reference names.
 *
 * `evidence_url` and `media_path` hold the path itself. The oldest check-ins
 * hold a signed URL to the same file. Anything else — a link elsewhere, a
 * path outside an owner's folder — is not a file of ours. Mirrors
 * `media_storage_path()` in migration 056.
 */
export function storagePathOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^[0-9a-fA-F-]{36}\/./.test(value)) return value;
  if (!/^https?:\/\//.test(value)) return null;
  const match = value.match(
    /\/storage\/v1\/object\/(?:sign|public|authenticated)\/completions\/([0-9a-fA-F-]{36}\/[^?#]+)/,
  );
  return match ? match[1] : null;
}

/** Every file under a folder, however deep. */
async function filesUnder(storage: StorageLike, bucket: string, folder: string): Promise<string[]> {
  const files: string[] = [];
  const folders = [folder];

  while (folders.length > 0) {
    const current = folders.pop()!;
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await storage.from(bucket).list(current, {
        limit: LIST_PAGE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`listing ${bucket}/${current}: ${error.message}`);

      const entries = data ?? [];
      for (const entry of entries) {
        const path = `${current}/${entry.name}`;
        if (entry.id === null) folders.push(path);
        else files.push(path);
      }
      if (entries.length < LIST_PAGE) break;
    }
  }
  return files;
}

/** Remove these files. Ones already gone are not an error. */
export async function removeStoredFiles(
  storage: StorageLike,
  bucket: string,
  paths: string[],
): Promise<number> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    const { error } = await storage.from(bucket).remove(batch);
    if (error) throw new Error(`removing from ${bucket}: ${error.message}`);
  }
  return paths.length;
}

/**
 * Remove everything under a folder: the files in it and in every folder
 * below it. Returns how many files there were.
 */
export async function removeStorageFolder(
  storage: StorageLike,
  bucket: string,
  folder: string,
): Promise<number> {
  return removeStoredFiles(storage, bucket, await filesUnder(storage, bucket, folder));
}
