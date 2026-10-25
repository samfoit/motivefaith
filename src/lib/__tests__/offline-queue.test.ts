import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Replace global indexedDB with a fresh instance before each test
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.resetModules();
});

async function getModule() {
  return import("../offline-queue");
}

describe("queueCompletion", () => {
  it("stores a completion in IndexedDB", async () => {
    const { queueCompletion, getPendingCount } = await getModule();
    await queueCompletion({ habitId: "h1", type: "quick" });
    const count = await getPendingCount();
    expect(count).toBe(1);
  });

  it("generates a unique id (multiple items stored)", async () => {
    const { queueCompletion, getPendingCount } = await getModule();
    await queueCompletion({ habitId: "h1", type: "quick" });
    await queueCompletion({ habitId: "h2", type: "photo" });
    const count = await getPendingCount();
    expect(count).toBe(2);
  });

  it("sets queuedAt timestamp", async () => {
    const { queueCompletion, getPendingCount } = await getModule();
    await queueCompletion({ habitId: "h1", type: "quick" });
    const count = await getPendingCount();
    expect(count).toBe(1);
  });

  it("works without Background Sync (no service worker)", async () => {
    const { queueCompletion, getPendingCount } = await getModule();
    await queueCompletion({ habitId: "h1", type: "message", notes: "Done!" });
    const count = await getPendingCount();
    expect(count).toBe(1);
  });
});

describe("getPendingCount", () => {
  it("returns 0 when empty", async () => {
    const { getPendingCount } = await getModule();
    const count = await getPendingCount();
    expect(count).toBe(0);
  });

  it("returns correct count after queuing", async () => {
    const { queueCompletion, getPendingCount } = await getModule();
    await queueCompletion({ habitId: "h1", type: "quick" });
    await queueCompletion({ habitId: "h2", type: "quick" });
    await queueCompletion({ habitId: "h3", type: "quick" });
    const count = await getPendingCount();
    expect(count).toBe(3);
  });

  it("returns 0 on IndexedDB failure", async () => {
    // Replace with a broken indexedDB before importing module
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB broken");
      },
    });
    vi.resetModules();
    const { getPendingCount } = await getModule();
    const count = await getPendingCount();
    expect(count).toBe(0);
  });
});

describe("schema upgrades", () => {
  it("doesn't hold up a newer page raising the database version", async () => {
    const { queueCompletion, getPendingCount } = await getModule();
    await queueCompletion({ habitId: "h1", type: "quick" });
    expect(await getPendingCount()).toBe(1);

    // This tab's connections are all still open; a newer page asking for the
    // next version must get it now, not once this tab closes.
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
