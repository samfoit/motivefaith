import { afterEach, describe, expect, it, vi } from "vitest";
import {
  purgeQueuedMedia,
  type PurgeClient,
} from "../supabase/functions/purge-media/purge";

/**
 * Taking deleted media off the purge queue and out of storage (056). The
 * queue itself — what gets on it, and what is dropped when a row wants it
 * again — is tests/media-purge.test.sql; this is the loop around it.
 */

interface Queued {
  bucket: string;
  path: string;
}

/** A queue and a bucket store, standing in for the database and storage. */
function fakeProject(queue: Queued[], { failRemove = new Set<string>(), failFinish = false } = {}) {
  const stored = new Set(queue.map((q) => `${q.bucket}/${q.path}`));
  const claimedOnce = new Set<string>();
  const calls: string[] = [];

  const client: PurgeClient = {
    rpc: async (fn, args) => {
      calls.push(fn);
      if (fn === "claim_media_purge") {
        // As the real one: what was just tried is not handed out again.
        const due = queue.filter((q) => !claimedOnce.has(`${q.bucket}/${q.path}`));
        const batch = due.slice(0, args.p_limit as number);
        batch.forEach((q) => claimedOnce.add(`${q.bucket}/${q.path}`));
        return { data: batch.map((q) => ({ ...q })), error: null };
      }
      if (fn === "finish_media_purge") {
        if (failFinish) return { data: null, error: { message: "connection reset" } };
        const paths = new Set(args.p_paths as string[]);
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].bucket === args.p_bucket && paths.has(queue[i].path)) queue.splice(i, 1);
        }
        return { data: paths.size, error: null };
      }
      return { data: null, error: { message: `unexpected ${fn}` } };
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          calls.push(`remove:${bucket}:${paths.length}`);
          if (failRemove.has(bucket)) return { data: null, error: { message: "storage is down" } };
          paths.forEach((p) => stored.delete(`${bucket}/${p}`));
          return { data: [], error: null };
        },
      }),
    },
  };

  return { client, stored, queue, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("purging queued media", () => {
  it("removes each file from its own bucket and takes it off the queue", async () => {
    const project = fakeProject([
      { bucket: "completions", path: "u1/h1/1.webp" },
      { bucket: "completions", path: "u1/capture/2.mp4" },
      { bucket: "avatars", path: "u1/avatar.webp" },
    ]);

    expect(await purgeQueuedMedia(project.client)).toEqual({ removed: 3, failed: 0 });
    expect(project.stored.size).toBe(0);
    expect(project.queue).toEqual([]);
    expect(project.calls).toContain("remove:completions:2");
    expect(project.calls).toContain("remove:avatars:1");
  });

  it("does nothing, and asks once, when the queue is empty", async () => {
    const project = fakeProject([]);
    expect(await purgeQueuedMedia(project.client)).toEqual({ removed: 0, failed: 0 });
    expect(project.calls).toEqual(["claim_media_purge"]);
  });

  it("keeps going past one batch until the queue is drained", async () => {
    const files = Array.from({ length: 7 }, (_, i) => ({ bucket: "completions", path: `u1/h1/${i}.webp` }));
    const project = fakeProject(files);

    expect(await purgeQueuedMedia(project.client, { batchSize: 3 })).toEqual({ removed: 7, failed: 0 });
    expect(project.stored.size).toBe(0);
    expect(project.calls.filter((c) => c === "claim_media_purge")).toHaveLength(3);
  });

  it("stops at its batch limit, leaving the rest for the next run", async () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ bucket: "completions", path: `u1/h1/${i}.webp` }));
    const project = fakeProject(files);

    expect(await purgeQueuedMedia(project.client, { batchSize: 2, maxBatches: 2 })).toEqual({
      removed: 4,
      failed: 0,
    });
    expect(project.queue).toHaveLength(6);
  });

  it("leaves a file queued when storage refuses, and still removes the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const project = fakeProject(
      [
        { bucket: "completions", path: "u1/h1/1.webp" },
        { bucket: "avatars", path: "u1/avatar.webp" },
      ],
      { failRemove: new Set(["completions"]) },
    );

    expect(await purgeQueuedMedia(project.client)).toEqual({ removed: 1, failed: 1 });
    expect(project.queue).toEqual([{ bucket: "completions", path: "u1/h1/1.webp" }]);
    expect(project.stored.has("completions/u1/h1/1.webp")).toBe(true);
  });

  it("counts a removed file as unfinished when the queue could not be told", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const project = fakeProject([{ bucket: "completions", path: "u1/h1/1.webp" }], { failFinish: true });

    // The file is gone; the entry stays, and the next run removes nothing and clears it.
    expect(await purgeQueuedMedia(project.client)).toEqual({ removed: 0, failed: 1 });
    expect(project.stored.size).toBe(0);
    expect(project.queue).toHaveLength(1);
  });

  it("fails loudly when the queue cannot be read", async () => {
    const client: PurgeClient = {
      rpc: async () => ({ data: null, error: { message: "permission denied for function claim_media_purge" } }),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    };
    await expect(purgeQueuedMedia(client)).rejects.toThrow(/claim_media_purge: permission denied/);
  });

  it("ignores anything in the answer that is not a bucket and a path", async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const client: PurgeClient = {
      rpc: async (fn) =>
        fn === "claim_media_purge"
          ? { data: [{ bucket: "completions" }, null, "x", { bucket: "completions", path: "u1/h1/1.webp" }], error: null }
          : { data: 1, error: null },
      storage: { from: () => ({ remove }) },
    };

    expect(await purgeQueuedMedia(client)).toEqual({ removed: 1, failed: 0 });
    expect(remove).toHaveBeenCalledWith(["u1/h1/1.webp"]);
  });
});
