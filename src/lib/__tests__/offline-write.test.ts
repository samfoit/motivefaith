import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", { randomUUID: () => `id-${Math.random().toString(36).slice(2)}` });
  setOnline(true);
  vi.resetModules();
});

function setOnline(online: boolean) {
  vi.stubGlobal("navigator", { onLine: online });
}

async function getModules() {
  const queue = await import("../offline-queue");
  const write = await import("../offline-write");
  return { ...queue, ...write };
}

/**
 * Minimal stand-in for the Supabase client, recording what each table was
 * asked to do and replying with whatever the test queued up.
 */
function fakeSupabase(responses: Record<string, { error: { code: string } | null }>) {
  const calls: { table: string; op: string; args: unknown }[] = [];
  const reply = (table: string, op: string) =>
    responses[`${table}.${op}`] ?? { error: null };

  const client = {
    calls,
    from(table: string) {
      const chain = {
        insert(args: unknown) {
          calls.push({ table, op: "insert", args });
          return Promise.resolve(reply(table, "insert"));
        },
        upsert(args: unknown) {
          calls.push({ table, op: "upsert", args });
          return Promise.resolve(reply(table, "upsert"));
        },
        update(args: unknown) {
          calls.push({ table, op: "update", args });
          return { eq: () => ({ eq: () => Promise.resolve(reply(table, "update")) }) };
        },
        delete() {
          calls.push({ table, op: "delete", args: null });
          return { eq: () => ({ eq: () => Promise.resolve(reply(table, "delete")) }) };
        },
      };
      return chain;
    },
  };
  // The real client is far wider than this; the replay only touches the above.
  return client as unknown as Parameters<
    Awaited<ReturnType<typeof getModules>>["replayOutbox"]
  >[0] & { calls: typeof calls };
}

const USER = "user-1";

describe("sendOrQueue", () => {
  it("queues instead of sending when offline", async () => {
    setOnline(false);
    const { sendOrQueue, getOutboxCount } = await getModules();
    const send = vi.fn();

    const result = await sendOrQueue(
      { id: "h1", kind: "habit.create", userId: USER, payload: {} },
      send,
    );

    expect(result).toEqual({ queued: true });
    expect(send).not.toHaveBeenCalled();
    expect(await getOutboxCount()).toBe(1);
  });

  it("queues when the request dies despite navigator.onLine", async () => {
    const { sendOrQueue, getOutboxCount } = await getModules();
    const result = await sendOrQueue(
      { id: "h1", kind: "habit.create", userId: USER, payload: {} },
      async () => {
        throw new TypeError("Failed to fetch");
      },
    );

    expect(result).toEqual({ queued: true });
    expect(await getOutboxCount()).toBe(1);
  });

  it("rethrows a server rejection rather than promising a later sync", async () => {
    const { sendOrQueue, getOutboxCount } = await getModules();

    await expect(
      sendOrQueue({ id: "h1", kind: "habit.create", userId: USER, payload: {} }, async () => {
        throw Object.assign(new Error("denied"), { code: "42501" });
      }),
    ).rejects.toThrow("denied");

    expect(await getOutboxCount()).toBe(0);
  });
});

describe("replayOutbox", () => {
  async function queueHabitCreate(mods: Awaited<ReturnType<typeof getModules>>, id: string) {
    await mods.queueWrite({
      id,
      kind: "habit.create",
      userId: USER,
      payload: { habit: { title: "Run" }, friendIds: ["f1"], groupIds: [] },
    });
  }

  it("applies a queued habit create, with its shares", async () => {
    const mods = await getModules();
    await queueHabitCreate(mods, "habit-1");
    const supabase = fakeSupabase({});

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 1, dropped: 0 });
    expect(await mods.getOutboxCount()).toBe(0);
    expect(supabase.calls.map((c) => `${c.table}.${c.op}`)).toEqual([
      "habits.insert",
      "habit_shares.upsert",
    ]);
  });

  it("treats a duplicate key as already applied", async () => {
    const mods = await getModules();
    await queueHabitCreate(mods, "habit-1");
    // An earlier drain was interrupted after the server accepted the insert.
    const supabase = fakeSupabase({ "habits.insert": { error: { code: "23505" } } });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 1, dropped: 0 });
    expect(await mods.getOutboxCount()).toBe(0);
  });

  it("drops a row the server will never accept", async () => {
    const mods = await getModules();
    await queueHabitCreate(mods, "habit-1");
    // 42501 = RLS denied. Retrying forever would wedge everything behind it.
    const supabase = fakeSupabase({ "habits.insert": { error: { code: "42501" } } });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 0, dropped: 1 });
    expect(await mods.getOutboxCount()).toBe(0);
  });

  it("keeps a row, and everything after it, on a transient failure", async () => {
    const mods = await getModules();
    await queueHabitCreate(mods, "habit-1");
    await new Promise((r) => setTimeout(r, 5));
    await mods.queueWrite({
      id: "e1",
      kind: "encouragement.create",
      userId: USER,
      payload: { content: "❤️" },
    });

    const supabase = fakeSupabase({ "habits.insert": { error: { code: "08006" } } });
    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 0, dropped: 0 });
    // Both still queued — the later write must not overtake the earlier one.
    expect(await mods.getOutboxCount()).toBe(2);
    expect(await mods.claimOutbox(USER)).toHaveLength(2);
  });

  it("replays oldest first", async () => {
    const mods = await getModules();
    await queueHabitCreate(mods, "habit-1");
    await new Promise((r) => setTimeout(r, 5));
    await mods.queueWrite({
      id: "h2",
      kind: "habit.update",
      userId: USER,
      payload: { habitId: "habit-1", patch: { title: "Jog" } },
    });

    const supabase = fakeSupabase({});
    await mods.replayOutbox(supabase, USER);

    const ops = supabase.calls.map((c) => `${c.table}.${c.op}`);
    expect(ops.indexOf("habits.insert")).toBeLessThan(ops.indexOf("habits.update"));
  });

  it("never replays another user's queued write", async () => {
    const mods = await getModules();
    await mods.queueWrite({
      id: "other",
      kind: "habit.create",
      userId: "someone-else",
      payload: { habit: { title: "Theirs" } },
    });

    const supabase = fakeSupabase({});
    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 0, dropped: 0 });
    expect(supabase.calls).toHaveLength(0);
    expect(await mods.getOutboxCount()).toBe(1);
  });

  it("hands the same row to only one drainer", async () => {
    const mods = await getModules();
    await queueHabitCreate(mods, "habit-1");

    expect(await mods.claimOutbox(USER)).toHaveLength(1);
    expect(await mods.claimOutbox(USER)).toHaveLength(0);
  });
});

describe("motive-offline v1 -> v2 upgrade", () => {
  it("keeps completions queued by the previous version", async () => {
    // A user upgrading mid-flight has rows in the v1 store. Losing them would
    // lose check-ins they already made.
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("motive-offline", 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("pending-completions", { keyPath: "id" });
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("pending-completions", "readwrite");
        tx.objectStore("pending-completions").put({
          id: "old-1", habitId: "h1", type: "quick", queuedAt: "2026-01-01T00:00:00Z",
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });

    const { getPendingCount, getOutboxCount } = await getModules();

    expect(await getPendingCount()).toBe(1);
    expect(await getOutboxCount()).toBe(0);
  });
});
