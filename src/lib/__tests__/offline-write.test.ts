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
function fakeSupabase(
  responses: Record<string, { data?: unknown[]; error: Record<string, unknown> | null }>,
) {
  const calls: { table: string; op: string; args: unknown }[] = [];
  const reply = (table: string, op: string) =>
    responses[`${table}.${op}`] ?? { error: null };

  const client = {
    calls,
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, body: Blob, options: unknown) {
            calls.push({ table: `storage:${bucket}`, op: "upload", args: { path, body, options } });
            return Promise.resolve(reply("storage", "upload"));
          },
        };
      },
    },
    // Partner invitations go through an RPC rather than a table write — the
    // habit_shares state machine is not the client's to drive directly.
    rpc(name: string, args: unknown) {
      calls.push({ table: name, op: "rpc", args });
      return Promise.resolve(reply(name, "rpc"));
    },
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
        select(columns: string) {
          const filters: [string, unknown][] = [];
          calls.push({ table, op: "select", args: { columns, filters } });
          const query = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return query;
            },
            limit: () => Promise.resolve(responses[`${table}.select`] ?? { data: [], error: null }),
          };
          return query;
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

  it("queues when supabase-js hands back a dropped connection as an error", async () => {
    const { sendOrQueue, getOutboxCount } = await getModules();
    const result = await sendOrQueue(
      { id: "h1", kind: "habit.create", userId: USER, payload: {} },
      async () => {
        // What `const { error } = await supabase.from(...).insert(...)` holds
        // on lie-fi: navigator.onLine is still true.
        throw { message: "TypeError: Load failed", details: "", hint: "", code: "" };
      },
    );

    expect(result).toEqual({ queued: true });
    expect(await getOutboxCount()).toBe(1);
  });
});

describe("isOfflineError", () => {
  it("knows each supabase-js client's way of saying nothing got through", async () => {
    const { isOfflineError } = await getModules();

    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
    // Storage wraps the TypeError…
    expect(
      isOfflineError({
        name: "StorageUnknownError",
        message: "Failed to fetch",
        originalError: new TypeError("Failed to fetch"),
      }),
    ).toBe(true);
    // …auth reports a retryable error with no status…
    expect(
      isOfflineError({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }),
    ).toBe(true);
    // …and PostgREST turns it into text, here in Safari's words.
    expect(
      isOfflineError({ message: "TypeError: Load failed", details: "", hint: "", code: "" }),
    ).toBe(true);
  });

  it("doesn't take the server's answer for a dropped connection", async () => {
    const { isOfflineError } = await getModules();

    expect(
      isOfflineError({ message: "new row violates row-level security policy", code: "42501" }),
    ).toBe(false);
    expect(
      isOfflineError({
        name: "StorageApiError",
        message: "The resource already exists",
        status: 400,
        statusCode: "409",
      }),
    ).toBe(false);
    expect(
      isOfflineError({ name: "AuthRetryableFetchError", message: "Bad gateway", status: 502 }),
    ).toBe(false);
    expect(isOfflineError(new Error("boom"))).toBe(false);
    expect(isOfflineError(null)).toBe(false);
  });

  it("calls everything offline while the browser says it is", async () => {
    setOnline(false);
    const { isOfflineError } = await getModules();
    expect(isOfflineError(new Error("anything"))).toBe(true);
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

  it("applies a queued habit create, and invites its friends", async () => {
    const mods = await getModules();
    await queueHabitCreate(mods, "habit-1");
    const supabase = fakeSupabase({});

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 1, dropped: 0 });
    expect(await mods.getOutboxCount()).toBe(0);
    expect(supabase.calls.map((c) => `${c.table}.${c.op}`)).toEqual([
      "habits.insert",
      "invite_habit_partner.rpc",
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

describe("replayOutbox: a capture taken offline", () => {
  const PATH = `${USER}/capture/take-1.webp`;

  type Payload = Parameters<
    Awaited<ReturnType<typeof getModules>>["queueCaptureShare"]
  >[0]["payload"];

  async function queueTake(
    mods: Awaited<ReturnType<typeof getModules>>,
    overrides: Partial<Payload> = {},
  ) {
    await mods.queueCaptureShare({
      id: "take-1",
      userId: USER,
      payload: {
        media: new Uint8Array([1, 2, 3]).buffer,
        contentType: "image/webp",
        mediaPath: PATH,
        mediaType: "photo",
        caption: "morning",
        habitIds: ["h1"],
        friendIds: ["f1"],
        groupIds: [],
        isPrivate: false,
        ...overrides,
      },
    });
  }

  const ops = (supabase: ReturnType<typeof fakeSupabase>) =>
    supabase.calls.map((c) => `${c.table}.${c.op}`);

  /** Storage's reply to a second upload to the same path. */
  const ALREADY_THERE = {
    error: { name: "StorageApiError", message: "The resource already exists", statusCode: "409" },
  };

  it("uploads the take to the path it was queued with, then shares it", async () => {
    const mods = await getModules();
    await queueTake(mods);
    const supabase = fakeSupabase({});

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 1, dropped: 0 });
    expect(await mods.getOutboxCount()).toBe(0);
    expect(ops(supabase)).toEqual(["storage:completions.upload", "share_capture.rpc"]);

    const upload = supabase.calls[0].args as { path: string; body: Blob; options: unknown };
    expect(upload.path).toBe(PATH);
    expect(upload.body.size).toBe(3);
    expect(upload.body.type).toBe("image/webp");
    expect(upload.options).toEqual({ contentType: "image/webp" });
    expect(supabase.calls[1].args).toEqual({
      p_media_path: PATH,
      p_media_type: "photo",
      p_caption: "morning",
      p_habit_ids: ["h1"],
      p_friend_ids: ["f1"],
      p_group_ids: [],
      p_private: false,
    });
  });

  it("doesn't send it again when an earlier drain already did", async () => {
    const mods = await getModules();
    await queueTake(mods);
    // That drain was cut off after share_capture, before it could take the
    // row off the queue.
    const supabase = fakeSupabase({
      "storage.upload": ALREADY_THERE,
      "completions.select": { data: [{ id: "c1" }], error: null },
    });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 1, dropped: 0 });
    expect(ops(supabase)).toEqual(["storage:completions.upload", "completions.select"]);
    expect(supabase.calls[1].args).toEqual({
      columns: "id",
      filters: [
        ["user_id", USER],
        ["evidence_url", PATH],
      ],
    });
  });

  it("sends a take that reached storage but was never shared", async () => {
    const mods = await getModules();
    await queueTake(mods);
    const supabase = fakeSupabase({ "storage.upload": ALREADY_THERE });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 1, dropped: 0 });
    expect(ops(supabase)).toEqual([
      "storage:completions.upload",
      "completions.select",
      "share_capture.rpc",
    ]);
  });

  it.each([
    {
      sentTo: "a habit, privately",
      payload: { mediaPath: `${USER}/private/take-1.webp`, friendIds: [], isPrivate: true },
      table: "completion_private_content",
      column: "evidence_url",
    },
    {
      sentTo: "a friend",
      payload: { habitIds: [], friendIds: ["f1"] },
      table: "encouragements",
      column: "media_path",
    },
    {
      sentTo: "a group",
      payload: { habitIds: [], friendIds: [], groupIds: ["g1"] },
      table: "group_messages",
      column: "media_path",
    },
  ])("looks for a take sent to $sentTo where it would have landed", async ({ payload, table, column }) => {
    const mods = await getModules();
    await queueTake(mods, payload);
    const supabase = fakeSupabase({
      "storage.upload": ALREADY_THERE,
      [`${table}.select`]: { data: [{ id: "row" }], error: null },
    });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 1, dropped: 0 });
    expect(ops(supabase)).toEqual(["storage:completions.upload", `${table}.select`]);
    expect((supabase.calls[1].args as { filters: unknown[] }).filters).toContainEqual([
      column,
      payload.mediaPath ?? PATH,
    ]);
  });

  it("keeps the take when the upload can't get through", async () => {
    const mods = await getModules();
    await queueTake(mods);
    const supabase = fakeSupabase({
      "storage.upload": {
        error: {
          name: "StorageUnknownError",
          message: "Failed to fetch",
          originalError: new TypeError("Failed to fetch"),
        },
      },
    });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 0, dropped: 0 });
    expect(ops(supabase)).toEqual(["storage:completions.upload"]);
    expect(await mods.getOutboxCount()).toBe(1);
  });

  it("keeps the take when it can't tell whether it was already sent", async () => {
    const mods = await getModules();
    await queueTake(mods);
    const supabase = fakeSupabase({
      "storage.upload": ALREADY_THERE,
      "completions.select": { data: undefined, error: { code: "", message: "TypeError: Failed to fetch" } },
    });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 0, dropped: 0 });
    expect(ops(supabase)).not.toContain("share_capture.rpc");
    expect(await mods.getOutboxCount()).toBe(1);
  });

  it("gives up on a take for a habit paused since it was queued", async () => {
    const mods = await getModules();
    await queueTake(mods);
    // share_capture refuses it through insert_completion (047), and will go
    // on refusing while the habit is paused.
    const supabase = fakeSupabase({
      "share_capture.rpc": { error: { code: "55000", message: "Habit is paused" } },
    });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 0, dropped: 1 });
    expect(await mods.getOutboxCount()).toBe(0);
  });

  it("gives up on a take too large for the bucket", async () => {
    const mods = await getModules();
    await queueTake(mods);
    const supabase = fakeSupabase({
      "storage.upload": {
        error: { message: "The object exceeded the maximum allowed size", statusCode: "413" },
      },
    });

    const result = await mods.replayOutbox(supabase, USER);

    expect(result).toEqual({ applied: 0, dropped: 1 });
    expect(await mods.getOutboxCount()).toBe(0);
  });

  it("drops a send the server refuses, and keeps one it rate-limits", async () => {
    const refused = await getModules();
    await queueTake(refused);
    // No longer friends: that will still be true next time.
    const denied = fakeSupabase({ "share_capture.rpc": { error: { code: "42501" } } });
    expect(await refused.replayOutbox(denied, USER)).toEqual({ applied: 0, dropped: 1 });
    expect(await refused.getOutboxCount()).toBe(0);

    await queueTake(refused);
    // insert_completion's ten-a-minute limit passes.
    const limited = fakeSupabase({ "share_capture.rpc": { error: { code: "54000" } } });
    expect(await refused.replayOutbox(limited, USER)).toEqual({ applied: 0, dropped: 0 });
    expect(await refused.getOutboxCount()).toBe(1);
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
