/**
 * Page-side drain for the offline write queue.
 *
 * The service worker drains the queue via Background Sync, which is the right
 * mechanism because it works with the app closed. But `SyncManager` does not
 * exist in Safari or on iOS at all, and `queueCompletion()` is the only thing
 * that ever registers a sync — so on those browsers a queued completion was
 * stranded forever: the next online completion goes straight to the RPC and
 * never looks at the queue.
 *
 * This module is the complement, not a replacement: it drains from an open
 * page on the events that actually correlate with regained connectivity.
 *
 * Because both paths exist, rows are *claimed* before they are sent — see
 * `claimPendingCompletions`. `inFlight` below only de-duplicates drains within
 * this page; the claim is what stops the page and the service worker sending
 * the same completion twice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { replayOutbox } from "@/lib/offline-write";
import {
  getOutboxCount,
  claimPendingCompletions,
  releasePendingCompletions,
  deletePendingCompletions,
  getPendingCount,
  type QueuedCompletion,
} from "@/lib/offline-queue";

/** The batch endpoint's documented limit. */
const MAX_BATCH = 50;

/**
 * De-duplicates concurrent drains *within this page* — two triggers firing
 * together, e.g. `online` and `visibilitychange`. Cross-context de-duplication
 * is the claim's job, not this one's.
 */
let inFlight: Promise<DrainResult> | null = null;

export interface DrainResult {
  /** Rows accepted by the server and removed from the queue. */
  synced: number;
  /** Rows dropped as permanently invalid — they would never succeed. */
  dropped: number;
  /** Rows still queued, to be retried on a later drain. */
  remaining: number;
}

/**
 * What the page can offer beyond completions.
 *
 * Completions drain over HTTP so the service worker can send them with the app
 * closed. The other queued writes replay through the Supabase client, which
 * only a page has — so they need this.
 */
export interface DrainContext {
  supabase: SupabaseClient<Database>;
  userId: string | null;
}

let context: DrainContext | null = null;

/** Called by `useOutboxDrain` once the user is known. */
export function setDrainContext(next: DrainContext | null) {
  context = next;
}

/** Shape the queue row into the payload the API expects. */
function toApiItem(row: QueuedCompletion) {
  return {
    habitId: row.habitId,
    type: row.type,
    notes: row.notes || undefined,
    rainCheckReason: row.rainCheckReason || undefined,
    rainCheckMovedTo: row.rainCheckMovedTo || undefined,
    // evidenceUrl is deliberately omitted — blob URLs captured offline are not
    // resolvable from the server. Matches the service worker's behaviour.
  };
}

async function postBatch(rows: QueuedCompletion[]): Promise<Response> {
  return fetch("/api/completions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows.map(toApiItem)),
  });
}

/**
 * Send one chunk, returning the ids to remove from the queue.
 *
 * `insert_completions_batch` is atomic, so a 400 caused by a single malformed
 * row rejects the whole chunk. Retrying the chunk as-is would then fail
 * forever and wedge every well-formed row behind it — the bug that made the
 * service worker's `reject()`-on-failure path retry indefinitely. So a 400
 * falls back to one request per row, which isolates the bad one and lets the
 * rest through.
 *
 * Returns `null` to mean "stop draining" — the failure is transient (offline,
 * auth expired, server error) and the rows must be kept for a later attempt.
 */
async function syncChunk(
  rows: QueuedCompletion[],
  allowSplit: boolean,
): Promise<{ synced: string[]; dropped: string[] } | null> {
  let response: Response;
  try {
    response = await postBatch(rows);
  } catch {
    // Network failure — still offline, or lost mid-flight. Keep everything.
    return null;
  }

  if (response.ok) {
    return { synced: rows.map((r) => r.id), dropped: [] };
  }

  // 401/403 auth expired, 429 rate limited, 5xx server-side — all retryable,
  // and none of them are the row's fault. Stop and keep the queue intact.
  if (response.status !== 400) return null;

  // A single row that the server rejects on its merits will never succeed.
  if (rows.length === 1) return { synced: [], dropped: [rows[0].id] };

  if (!allowSplit) return null;

  const synced: string[] = [];
  const dropped: string[] = [];
  for (const row of rows) {
    const result = await syncChunk([row], false);
    if (result === null) {
      // Turned transient partway through — keep this row and everything after.
      return synced.length || dropped.length ? { synced, dropped } : null;
    }
    synced.push(...result.synced);
    dropped.push(...result.dropped);
  }
  return { synced, dropped };
}

async function runDrain(): Promise<DrainResult> {
  // Claiming is what makes this safe to run alongside the service worker's
  // Background Sync drain: whichever context claims a row is the only one
  // that will send it.
  const rows = await claimPendingCompletions();

  let synced = 0;
  let dropped = 0;
  const unsent: string[] = [];

  for (let i = 0; i < rows.length; i += MAX_BATCH) {
    const chunk = rows.slice(i, i + MAX_BATCH);
    const result = await syncChunk(chunk, true);

    if (result === null) {
      // Transient — hand this chunk and everything after it back.
      unsent.push(...rows.slice(i).map((r) => r.id));
      break;
    }

    await deletePendingCompletions([...result.synced, ...result.dropped]);
    synced += result.synced.length;
    dropped += result.dropped.length;

    const settled = new Set([...result.synced, ...result.dropped]);
    const leftover = rows.slice(i).filter((r) => !settled.has(r.id));
    if (settled.size < chunk.length) {
      unsent.push(...leftover.map((r) => r.id));
      break;
    }
  }

  // Anything we claimed but did not send must not stay claimed, or it would
  // sit untouchable until the claim expires.
  await releasePendingCompletions(unsent);

  // Habit edits, hearts and the like. Replayed through the Supabase client
  // rather than an HTTP endpoint, so this half only runs from a page.
  if (context?.userId) {
    try {
      const outbox = await replayOutbox(context.supabase, context.userId);
      synced += outbox.applied;
      dropped += outbox.dropped;
    } catch (err) {
      console.error("Outbox replay failed:", err);
    }
  }

  const remaining = (await getPendingCount()) + (await getOutboxCount());
  if (synced > 0 || dropped > 0) notifyPendingChanged();
  return { synced, dropped, remaining };
}

/**
 * Flush the queue. Safe to call at any time, from anywhere, concurrently.
 * Callers that do not care about the outcome can ignore the promise.
 */
export function drainOutbox(): Promise<DrainResult> {
  if (inFlight) return inFlight;
  inFlight = runDrain()
    .catch((err): DrainResult => {
      console.error("Outbox drain failed:", err);
      return { synced: 0, dropped: 0, remaining: 0 };
    })
    .finally(() => {
      inFlight = null;
    }) as Promise<DrainResult>;
  return inFlight;
}

// ---------------------------------------------------------------------------
// Pending-count subscription, so the offline banner can update live
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

/** Tell subscribers the queue changed, so they can re-read the count. */
export function notifyPendingChanged() {
  for (const listener of listeners) listener();
}

export function subscribeToPending(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
