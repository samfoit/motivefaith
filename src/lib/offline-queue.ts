/**
 * IndexedDB-backed offline queue for habit completions.
 * When the user is offline, completions are stored here and
 * synced via the service worker's Background Sync API.
 */

const DB_NAME = "motive-offline";
const DB_VERSION = 2;
const STORE_NAME = "pending-completions";

/**
 * Queued writes other than completions.
 *
 * Deliberately a second store rather than one generic outbox that completions
 * were migrated into. Completions have their own shape and their own transport
 * — an atomic, rate-limited batch RPC behind /api/completions, which the
 * service worker's Background Sync posts to so they sync even with the app
 * closed. Service workers already deployed read `pending-completions` by name,
 * so folding it into a new store would strand whatever those users had queued.
 * These writes are individually idempotent upserts replayed by the page, which
 * is a different enough problem to deserve its own store.
 */
const OUTBOX_STORE = "outbox";

import type { CompletionType } from "@/lib/constants/completion";
import type { RainCheckReason } from "@/lib/constants/rain-check";

export interface QueuedCompletion {
  id: string;
  habitId: string;
  type: CompletionType;
  evidenceUrl?: string;
  notes?: string;
  /** Only set on a "rain_check". */
  rainCheckReason?: RainCheckReason;
  /** Only set on a "rain_check" that was moved; a YYYY-MM-DD key. */
  rainCheckMovedTo?: string;
  queuedAt: string;
  /**
   * When some context took responsibility for sending this row, ISO.
   *
   * The page and the service worker both drain the queue, in separate
   * JavaScript contexts that cannot share a lock. Without a claim they each
   * read the same rows on the same connectivity event and POST them twice —
   * observed in a real browser as two identical completions 80ms apart, which
   * is not harmless: a duplicate completion inflates the streak.
   *
   * The claim is taken inside the same readwrite transaction as the read, and
   * IndexedDB transactions are atomic across contexts, so exactly one drainer
   * can win a given row.
   */
  claimedAt?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      // v2. Existing pending-completions rows are left exactly where they are
      // — an upgrade must never lose a write the user already made.
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        store.createIndex("by-queuedAt", "queuedAt");
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Queue a completion for later sync.
 * Also registers a Background Sync so the SW will flush the queue
 * once connectivity returns.
 */
export async function queueCompletion(
  completion: Omit<QueuedCompletion, "id" | "queuedAt">,
): Promise<void> {
  const item: QueuedCompletion = {
    ...completion,
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
  };

  const db = await openDB();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Register Background Sync if available
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    const registration = await navigator.serviceWorker.ready;
    await (
      registration as ServiceWorkerRegistration & {
        sync: { register: (tag: string) => Promise<void> };
      }
    ).sync.register("sync-completions");
  }
}

/**
 * How long a claim is honoured before another drainer may take the row.
 *
 * A context can die mid-send — the tab closes, the user navigates away
 * mid-request, the worker is killed — and the release that would hand the row
 * back cannot finish during teardown. So the expiry is what actually recovers
 * those rows, and it bounds how long a completion can sit unsent after an
 * interrupted drain.
 *
 * 30s: comfortably longer than any healthy request to /api/completions, short
 * enough that an interrupted drain retries on the user's next visit rather
 * than a minute later. It can be cut much further once replay is idempotent
 * (client-minted completion ids), at which point a double-send is harmless.
 */
const CLAIM_TIMEOUT_MS = 30 * 1000;

/**
 * Take ownership of the unclaimed queued completions and return them.
 *
 * Read and claim happen in one readwrite transaction, so two drainers racing
 * on the same connectivity event cannot both take the same row.
 */
export async function claimPendingCompletions(): Promise<QueuedCompletion[]> {
  const db = await openDB();
  const claimed: QueuedCompletion[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const now = Date.now();
      for (const row of (request.result ?? []) as QueuedCompletion[]) {
        const heldSince = row.claimedAt ? Date.parse(row.claimedAt) : 0;
        if (heldSince && now - heldSince < CLAIM_TIMEOUT_MS) continue;
        store.put({ ...row, claimedAt: new Date(now).toISOString() });
        claimed.push(row);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return claimed.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/** Give rows back after a transient failure, so a later drain retries them. */
export async function releasePendingCompletions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) {
      const get = store.get(id);
      get.onsuccess = () => {
        const row = get.result as QueuedCompletion | undefined;
        if (!row) return;
        delete row.claimedAt;
        store.put(row);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Read every queued completion, oldest first.
 *
 * Replay order matters: two completions for the same habit on the same day
 * must reach the server in the order the user made them, or the second one
 * loses to the first's uniqueness constraint and the wrong one survives.
 */
export async function getPendingCompletions(): Promise<QueuedCompletion[]> {
  try {
    const db = await openDB();
    const rows = await new Promise<QueuedCompletion[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    return rows.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } catch (err) {
    console.error("Failed to read offline queue:", err);
    return [];
  }
}

/** Remove queued completions by id, after they have been accepted or dropped. */
export async function deletePendingCompletions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get the count of queued (pending) completions.
 */
export async function getPendingCount(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to read offline queue:", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Generic outbox — writes other than completions
// ---------------------------------------------------------------------------

/**
 * What kind of write is queued.
 *
 * Every kind must be safe to replay more than once, because a drain can be
 * interrupted after the server accepted the write but before the row was
 * removed. Ids are minted on the client for exactly that reason: `habits.id`
 * and `encouragements.id` are `uuid DEFAULT gen_random_uuid()` and the RLS
 * policies constrain `user_id`, not `id`, so the client may choose it. A
 * replayed create then collides on the primary key instead of inserting a
 * second row, and a replayed delete is a no-op.
 */
export type OutboxKind =
  | "habit.create"
  | "habit.update"
  | "encouragement.create"
  | "encouragement.delete";

export interface OutboxRecord {
  /** The outbox row's own id — also the created row's id, where it makes one. */
  id: string;
  kind: OutboxKind;
  /**
   * Who queued this.
   *
   * Replay skips rows belonging to anyone but the current user. Sign-out
   * deletes the database outright, so this is defence in depth for the window
   * where one user signs in before another's data has been cleared.
   */
  userId: string;
  payload: unknown;
  queuedAt: string;
  /** Number of failed replay attempts, so a poison row can be given up on. */
  attempts: number;
  lastError?: string;
  /** See CLAIM_TIMEOUT_MS — same protocol as the completions queue. */
  claimedAt?: string;
}

/** Add a write to the outbox. */
export async function queueWrite(
  record: Omit<OutboxRecord, "queuedAt" | "attempts">,
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).put({
      ...record,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Take ownership of this user's unclaimed outbox rows, oldest first. */
export async function claimOutbox(userId: string): Promise<OutboxRecord[]> {
  const db = await openDB();
  const claimed: OutboxRecord[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const now = Date.now();
      for (const row of (request.result ?? []) as OutboxRecord[]) {
        if (row.userId !== userId) continue;
        const heldSince = row.claimedAt ? Date.parse(row.claimedAt) : 0;
        if (heldSince && now - heldSince < CLAIM_TIMEOUT_MS) continue;
        store.put({ ...row, claimedAt: new Date(now).toISOString() });
        claimed.push(row);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return claimed.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/** Remove outbox rows that were accepted, or given up on. */
export async function deleteOutbox(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Release a claim and record why the attempt failed. */
export async function releaseOutbox(
  ids: string[],
  lastError?: string,
): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    for (const id of ids) {
      const get = store.get(id);
      get.onsuccess = () => {
        const row = get.result as OutboxRecord | undefined;
        if (!row) return;
        delete row.claimedAt;
        row.attempts = (row.attempts ?? 0) + 1;
        if (lastError) row.lastError = lastError;
        store.put(row);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** How many writes are waiting, for the offline indicator. */
export async function getOutboxCount(): Promise<number> {
  try {
    const db = await openDB();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readonly");
      const request = tx.objectStore(OUTBOX_STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return 0;
  }
}
