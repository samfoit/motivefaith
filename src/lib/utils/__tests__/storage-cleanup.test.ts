import { describe, it, expect } from "vitest";
import {
  removeStorageFolder,
  removeStoredFiles,
  storagePathOf,
  type StorageLike,
} from "../storage-cleanup";

/**
 * A bucket held in memory that answers `list` and `remove` the way Supabase
 * Storage does: a listing shows the files in a folder and the folders in it
 * (those with a null id), a page at a time; `remove` deletes exactly the
 * paths it is given, and a path that is not a file — a folder, say — is
 * silently nothing.
 */
function fakeBucket(paths: string[]) {
  const files = new Set(paths);
  const removeCalls: string[][] = [];
  const listCalls: string[] = [];

  const storage: StorageLike = {
    from: () => ({
      list: async (folder, { limit, offset }) => {
        listCalls.push(folder);
        const names = new Map<string, string | null>();
        for (const file of files) {
          if (!file.startsWith(`${folder}/`)) continue;
          const rest = file.slice(folder.length + 1);
          const slash = rest.indexOf("/");
          if (slash === -1) names.set(rest, `id-of-${file}`);
          else names.set(rest.slice(0, slash), null);
        }
        const entries = [...names.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .slice(offset, offset + limit)
          .map(([name, id]) => ({ name, id }));
        return { data: entries, error: null };
      },
      remove: async (toRemove) => {
        removeCalls.push([...toRemove]);
        for (const path of toRemove) files.delete(path);
        return { data: [], error: null };
      },
    }),
  };

  return { storage, files, removeCalls, listCalls };
}

const USER = "a1111111-1111-4111-8111-111111111111";
const HABIT = "b2222222-2222-4222-8222-222222222222";

describe("storagePathOf", () => {
  it("takes a path as it is", () => {
    expect(storagePathOf(`${USER}/${HABIT}/1700000000000.webp`)).toBe(`${USER}/${HABIT}/1700000000000.webp`);
    expect(storagePathOf(`${USER}/capture/abc.mp4`)).toBe(`${USER}/capture/abc.mp4`);
  });

  it("finds the path inside the signed URL an old check-in holds", () => {
    expect(
      storagePathOf(
        `https://project.supabase.co/storage/v1/object/sign/completions/${USER}/${HABIT}/1.webp?token=abc.def`,
      ),
    ).toBe(`${USER}/${HABIT}/1.webp`);
    expect(
      storagePathOf(`http://127.0.0.1:54321/storage/v1/object/public/completions/${USER}/capture/2.jpg`),
    ).toBe(`${USER}/capture/2.jpg`);
  });

  it("is nothing for a link elsewhere, another bucket, or no owner folder", () => {
    expect(storagePathOf("https://example.com/completions/alice/run1.jpg")).toBeNull();
    expect(
      storagePathOf(`https://project.supabase.co/storage/v1/object/sign/avatars/${USER}/avatar.webp`),
    ).toBeNull();
    expect(storagePathOf("capture/abc.webp")).toBeNull();
    expect(storagePathOf(`${USER}/`)).toBeNull();
    expect(storagePathOf("")).toBeNull();
    expect(storagePathOf(null)).toBeNull();
    expect(storagePathOf(undefined)).toBeNull();
  });
});

describe("removeStorageFolder", () => {
  it("removes the files inside the folders, not the folders", async () => {
    // What account deletion met: nothing directly under the user's folder,
    // everything one level down. It listed the top, got the three folders
    // back, asked storage to remove those, and removed nothing.
    const bucket = fakeBucket([
      `${USER}/${HABIT}/1.webp`,
      `${USER}/${HABIT}/2.mp4`,
      `${USER}/capture/3.webm`,
      `${USER}/private/4.webp`,
    ]);

    expect(await removeStorageFolder(bucket.storage, "completions", USER)).toBe(4);
    expect(bucket.files.size).toBe(0);
    for (const path of bucket.removeCalls.flat()) {
      expect(path).toMatch(/\.(webp|mp4|webm)$/);
    }
  });

  it("removes a file sitting directly in the folder, as an avatar does", async () => {
    const bucket = fakeBucket([`${USER}/avatar.webp`]);
    expect(await removeStorageFolder(bucket.storage, "avatars", USER)).toBe(1);
    expect(bucket.removeCalls).toEqual([[`${USER}/avatar.webp`]]);
  });

  it("goes as deep as the folders do", async () => {
    const bucket = fakeBucket([`${USER}/a/b/c/deep.webp`, `${USER}/a/shallow.webp`]);
    expect(await removeStorageFolder(bucket.storage, "completions", USER)).toBe(2);
    expect(bucket.files.size).toBe(0);
  });

  it("leaves everyone else's files alone", async () => {
    const other = "c3333333-3333-4333-8333-333333333333";
    const bucket = fakeBucket([`${USER}/capture/mine.webp`, `${other}/capture/theirs.webp`]);

    await removeStorageFolder(bucket.storage, "completions", USER);
    expect([...bucket.files]).toEqual([`${other}/capture/theirs.webp`]);
  });

  it("reads a folder with more files than one listing returns", async () => {
    const many = Array.from({ length: 2300 }, (_, i) => `${USER}/${HABIT}/${String(i).padStart(5, "0")}.webp`);
    const bucket = fakeBucket(many);

    expect(await removeStorageFolder(bucket.storage, "completions", USER)).toBe(2300);
    expect(bucket.files.size).toBe(0);
    // In batches, so one request never carries thousands of paths.
    expect(Math.max(...bucket.removeCalls.map((c) => c.length))).toBeLessThanOrEqual(100);
  });

  it("asks storage to remove nothing when there is nothing there", async () => {
    const bucket = fakeBucket([]);
    expect(await removeStorageFolder(bucket.storage, "completions", USER)).toBe(0);
    expect(bucket.removeCalls).toEqual([]);
  });

  it("fails rather than report a folder it could not read as empty", async () => {
    const storage: StorageLike = {
      from: () => ({
        list: async () => ({ data: null, error: { message: "Invalid Compact JWS" } }),
        remove: async () => ({ data: [], error: null }),
      }),
    };
    await expect(removeStorageFolder(storage, "completions", USER)).rejects.toThrow(/Invalid Compact JWS/);
  });
});

describe("removeStoredFiles", () => {
  it("fails when storage refuses the removal", async () => {
    const storage: StorageLike = {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: null, error: { message: "storage is down" } }),
      }),
    };
    await expect(removeStoredFiles(storage, "completions", [`${USER}/capture/a.webp`])).rejects.toThrow(
      /storage is down/,
    );
  });

  it("makes no request for an empty list", async () => {
    const bucket = fakeBucket([`${USER}/capture/a.webp`]);
    expect(await removeStoredFiles(bucket.storage, "completions", [])).toBe(0);
    expect(bucket.removeCalls).toEqual([]);
  });
});
