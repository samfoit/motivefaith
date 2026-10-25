import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The service worker's Background Sync drain, run against the queue as the
 * page actually leaves it.
 *
 * The worker and the page share the `motive-offline` database. The page owns
 * its schema and moved it to version 2 when the outbox store was added; the
 * worker kept asking for version 1, and IndexedDB refuses a lower version
 * outright. So every sync failed, and a check-in queued offline only went out
 * once the app was opened again.
 */

const SOURCE = readFileSync(join(__dirname, "..", "service-worker.js"), "utf8");

type Handler = (event: { tag: string; waitUntil: (p: Promise<unknown>) => void }) => void;

/** Evaluate the worker with just enough of a ServiceWorkerGlobalScope around it. */
function loadWorker({ windows = [] as unknown[] } = {}) {
  const handlers: Record<string, Handler> = {};
  const fetch = vi.fn<(url: string, init: { body: string }) => Promise<unknown>>(
    async () => ({ ok: true, status: 201, json: async () => [] }),
  );
  const self = {
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    location: { origin: "https://motive.test", hostname: "motive.test" },
    clients: { matchAll: async () => windows },
    registration: {},
    skipWaiting: () => {},
  };
  new Function("self", "indexedDB", "fetch", "caches", SOURCE)(
    self,
    indexedDB,
    fetch,
    {},
  );

  async function sync() {
    let done: Promise<unknown> = Promise.resolve();
    handlers.sync({ tag: "sync-completions", waitUntil: (p) => (done = p) });
    await done;
  }

  return { fetch, sync };
}

/** The database as the current page code creates it, with one check-in queued. */
async function pageQueue(rows: Record<string, unknown>[]) {
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("motive-offline", 2);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("pending-completions", { keyPath: "id" });
      open.result
        .createObjectStore("outbox", { keyPath: "id" })
        .createIndex("by-queuedAt", "queuedAt");
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("pending-completions", "readwrite");
      for (const row of rows) tx.objectStore("pending-completions").put(row);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
}

function queuedIds(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("motive-offline");
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction("pending-completions").objectStore("pending-completions").getAllKeys();
      req.onsuccess = () => {
        db.close();
        resolve(req.result as string[]);
      };
      req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
  });
}

const CHECK_IN = { id: "q1", habitId: "h1", type: "quick", queuedAt: "2026-10-24T14:00:00Z" };

describe("service worker Background Sync", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("sends what the page queued, from the database the page upgraded", async () => {
    await pageQueue([CHECK_IN]);
    const worker = loadWorker();

    await worker.sync();

    expect(worker.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = worker.fetch.mock.calls[0];
    expect(url).toBe("/api/completions");
    expect(JSON.parse(init.body)).toEqual([{ id: "q1", habitId: "h1", type: "quick" }]);
    expect(await queuedIds()).toEqual([]);
  });

  it("leaves the queue to an open page", async () => {
    await pageQueue([CHECK_IN]);
    const worker = loadWorker({ windows: [{ url: "https://motive.test/main/dashboard" }] });

    await worker.sync();

    expect(worker.fetch).not.toHaveBeenCalled();
    expect(await queuedIds()).toEqual(["q1"]);
  });

  it("steps aside when the page raises the schema again", async () => {
    await pageQueue([CHECK_IN]);
    const worker = loadWorker();
    await worker.sync();

    // A later page asking for a newer schema must not wait on the worker's
    // connection, which stays open for as long as the worker lives.
    const blocked = vi.fn();
    const upgraded = await new Promise<boolean>((resolve) => {
      const open = indexedDB.open("motive-offline", 3);
      open.onblocked = blocked;
      open.onsuccess = () => {
        open.result.close();
        resolve(true);
      };
      open.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 1000);
    });

    expect(upgraded).toBe(true);
    expect(blocked).not.toHaveBeenCalled();
  });
});
