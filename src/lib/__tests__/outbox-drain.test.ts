import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.resetModules();
});

/**
 * Both modules must come from the same registry instance, since the drain
 * reads the queue module's IndexedDB handle.
 */
async function getModules() {
  const queue = await import("../offline-queue");
  const drain = await import("../outbox-drain");
  return { ...queue, ...drain };
}

function response(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response;
}

describe("drainOutbox", () => {
  it("posts queued completions and clears them once accepted", async () => {
    const { queueCompletion, drainOutbox, getPendingCount } = await getModules();
    await queueCompletion({ habitId: "h1", type: "quick" });
    await queueCompletion({ habitId: "h2", type: "photo" });

    const fetchMock = vi.fn().mockResolvedValue(response(201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await drainOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/completions");
    expect(JSON.parse(init.body)).toHaveLength(2);
    expect(result.synced).toBe(2);
    expect(await getPendingCount()).toBe(0);
  });

  it("keeps rows queued when the network fails", async () => {
    const { queueCompletion, drainOutbox, getPendingCount } = await getModules();
    await queueCompletion({ habitId: "h1", type: "quick" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const result = await drainOutbox();

    expect(result.synced).toBe(0);
    expect(await getPendingCount()).toBe(1);
  });

  it.each([401, 429, 500])(
    "keeps rows queued on a retryable %i so nothing is lost",
    async (status) => {
      const { queueCompletion, drainOutbox, getPendingCount } = await getModules();
      await queueCompletion({ habitId: "h1", type: "quick" });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status)));

      await drainOutbox();

      expect(await getPendingCount()).toBe(1);
    },
  );

  it("isolates a permanently invalid row instead of wedging the queue", async () => {
    const { queueCompletion, drainOutbox, getPendingCount, getPendingCompletions } =
      await getModules();
    await queueCompletion({ habitId: "good-1", type: "quick" });
    await queueCompletion({ habitId: "bad", type: "quick" });
    await queueCompletion({ habitId: "good-2", type: "quick" });

    // The batch insert is atomic, so one bad row 400s the whole chunk. The
    // per-row retry is what stops the two good rows being stuck behind it.
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      const items = JSON.parse(init.body);
      const hasBad = items.some((i: { habitId: string }) => i.habitId === "bad");
      return Promise.resolve(response(hasBad ? 400 : 201));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await drainOutbox();

    expect(result.synced).toBe(2);
    expect(result.dropped).toBe(1);
    expect(await getPendingCount()).toBe(0);
    expect(await getPendingCompletions()).toHaveLength(0);
  });

  it("collapses concurrent drains into a single flush", async () => {
    const { queueCompletion, drainOutbox } = await getModules();
    await queueCompletion({ habitId: "h1", type: "quick" });

    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // A Background Sync drain and a page drain can fire on the same event.
    const first = drainOutbox();
    const second = drainOutbox();
    expect(first).toBe(second);

    resolveFetch(response(201));
    await first;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression test for a duplicate observed in a real browser: the page drain
   * and the service worker's Background Sync both flushed the same row on one
   * connectivity event, producing two identical completions 80ms apart. A
   * duplicate completion is not harmless — it inflates the streak.
   */
  it("never hands the same row to two drainers", async () => {
    const { queueCompletion, claimPendingCompletions } = await getModules();
    await queueCompletion({ habitId: "h1", type: "quick" });
    await queueCompletion({ habitId: "h2", type: "quick" });

    // Whichever context claims first takes the rows; the other gets nothing.
    const first = await claimPendingCompletions();
    const second = await claimPendingCompletions();

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
  });

  it("returns claimed rows to the queue when the send fails", async () => {
    const { queueCompletion, drainOutbox, claimPendingCompletions, getPendingCount } =
      await getModules();
    await queueCompletion({ habitId: "h1", type: "quick" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await drainOutbox();

    // Still queued...
    expect(await getPendingCount()).toBe(1);
    // ...and claimable again, rather than stranded until the claim expires.
    expect(await claimPendingCompletions()).toHaveLength(1);
  });

  it("leaves a row claimed only while it is genuinely in flight", async () => {
    const { queueCompletion, claimPendingCompletions, releasePendingCompletions } =
      await getModules();
    await queueCompletion({ habitId: "h1", type: "quick" });

    const claimed = await claimPendingCompletions();
    expect(await claimPendingCompletions()).toHaveLength(0);

    await releasePendingCompletions(claimed.map((r) => r.id));
    expect(await claimPendingCompletions()).toHaveLength(1);
  });

  it("does not call the network when the queue is empty", async () => {
    const { drainOutbox } = await getModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await drainOutbox();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, dropped: 0, remaining: 0 });
  });

  it("replays oldest first", async () => {
    const { queueCompletion, drainOutbox } = await getModules();
    await queueCompletion({ habitId: "first", type: "quick" });
    await new Promise((r) => setTimeout(r, 5));
    await queueCompletion({ habitId: "second", type: "quick" });

    const fetchMock = vi.fn().mockResolvedValue(response(201));
    vi.stubGlobal("fetch", fetchMock);

    await drainOutbox();

    const items = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(items.map((i: { habitId: string }) => i.habitId)).toEqual([
      "first",
      "second",
    ]);
  });

  it("omits evidenceUrl, which is not resolvable from the server", async () => {
    const { queueCompletion, drainOutbox } = await getModules();
    await queueCompletion({
      habitId: "h1",
      type: "photo",
      evidenceUrl: "blob:http://localhost/abc",
      notes: "done",
    });

    const fetchMock = vi.fn().mockResolvedValue(response(201));
    vi.stubGlobal("fetch", fetchMock);

    await drainOutbox();

    const [item] = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(item).not.toHaveProperty("evidenceUrl");
    expect(item.notes).toBe("done");
  });
});
