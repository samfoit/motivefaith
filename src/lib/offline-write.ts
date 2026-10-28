"use client";

/**
 * Queue-on-failure for writes other than habit completions.
 *
 * Completions have their own path (`useCompleteHabit` + the service worker's
 * Background Sync). Everything here is replayed by the page, through the same
 * Supabase client the online path uses — so there is one code path to reason
 * about and no second server endpoint to keep in step.
 *
 * The contract every caller must honour: **mint the row's id on the client**.
 * `habits.id` and `encouragements.id` are `uuid DEFAULT gen_random_uuid()` and
 * their RLS policies constrain `user_id` rather than `id`, so the client may
 * choose it. That is what makes replay idempotent — a drain interrupted after
 * the server accepted the write replays into a primary-key collision instead
 * of creating a duplicate. (A queued capture mints its media's storage path
 * instead; see `replayCaptureShare`.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { ShareCaptureParams } from "@/lib/hooks/useShareCapture";
import { untypedRpc } from "@/lib/supabase/rpc";
import { isUploadTooLarge } from "@/lib/utils/check-video";
import { HABIT_PAUSED_CODE } from "@/lib/constants/completion";
import {
  queueWrite,
  claimOutbox,
  deleteOutbox,
  releaseOutbox,
  type OutboxKind,
  type OutboxRecord,
} from "@/lib/offline-queue";

type Client = SupabaseClient<Database>;

/** Give up on a row after this many failed attempts, rather than retrying forever. */
const MAX_ATTEMPTS = 10;

/** Postgres duplicate-key. For a client-minted id this means "already applied". */
const UNIQUE_VIOLATION = "23505";

interface Postgrestish {
  code?: string;
  message?: string;
}

/**
 * A failure that means "the network didn't carry it", as opposed to "the
 * server considered it and said no".
 *
 * `fetch` rejects with TypeError when it cannot reach the host at all, which
 * covers offline, lie-fi and captive portals. `navigator.onLine` is checked
 * first only as a shortcut — it is unreliable on its own, which is why the
 * catch exists at all.
 *
 * supabase-js never lets that TypeError reach the caller: each of its clients
 * hands it back as an error value, and each wraps it differently.
 */
export function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (err instanceof TypeError) return true;
  if (typeof err !== "object" || err === null) return false;

  const e = err as {
    originalError?: unknown;
    name?: unknown;
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  // Storage: a StorageUnknownError holding the TypeError.
  if (e.originalError instanceof TypeError) return true;
  // Auth: a retryable error with no HTTP status, because there was no reply.
  if (e.name === "AuthRetryableFetchError" && e.status === 0) return true;
  // PostgREST: the TypeError's name and message as text, with no SQLSTATE.
  return (
    e.code === "" &&
    typeof e.message === "string" &&
    /^(TypeError|FetchError):/.test(e.message)
  );
}

/**
 * Whether a server rejection will still be a rejection next time.
 *
 * Retrying an RLS denial or a constraint violation forever would wedge the
 * queue behind a row that can never succeed — the bug the completions sync
 * had, where any failure was retried indefinitely.
 */
function isPermanent(error: Postgrestish | null | undefined): boolean {
  const code = error?.code ?? "";
  // 42xxx: syntax/access (42501 = RLS denied). 23xxx: integrity violations.
  // And a habit paused since the take was queued, which takes no check-ins.
  return (
    code.startsWith("42") ||
    code.startsWith("23") ||
    code.startsWith("22") ||
    code === HABIT_PAUSED_CODE
  );
}

/**
 * Run a write, falling back to the outbox when the network is the problem.
 *
 * A server-side rejection is rethrown: the user should be told their habit was
 * invalid, not quietly promised it will sync later.
 */
export async function sendOrQueue<T>(
  entry: { id: string; kind: OutboxKind; userId: string; payload: unknown },
  send: () => Promise<T>,
): Promise<T | { queued: true }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await queueWrite(entry);
    return { queued: true };
  }
  try {
    return await send();
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await queueWrite(entry);
    return { queued: true };
  }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

type ReplayOutcome = "done" | "permanent" | "transient";

interface HabitCreatePayload {
  habit: Database["public"]["Tables"]["habits"]["Insert"];
  friendIds?: string[];
  groupIds?: string[];
}

async function replayHabitCreate(
  supabase: Client,
  id: string,
  userId: string,
  payload: HabitCreatePayload,
): Promise<ReplayOutcome> {
  const { error } = await supabase
    .from("habits")
    .insert({ ...payload.habit, id, user_id: userId });

  // Already there — this row was applied by an earlier, interrupted drain.
  if (error && error.code !== UNIQUE_VIOLATION) {
    return isPermanent(error) ? "permanent" : "transient";
  }

  // Invitations are best-effort and independently idempotent; a failure here
  // should not put the habit itself back on the queue. invite_habit_partner
  // upserts on (habit_id, shared_with), so replaying it is safe — and it will
  // not knock an invitation the friend has already accepted back to pending.
  if (payload.friendIds?.length) {
    await Promise.all(
      payload.friendIds.map((sharedWith) =>
        untypedRpc(supabase, "invite_habit_partner", {
          p_habit_id: id,
          p_user_id: sharedWith,
        }),
      ),
    );
  }
  if (payload.groupIds?.length) {
    await supabase
      .from("group_habit_shares")
      .upsert(
        payload.groupIds.map((groupId) => ({
          group_id: groupId,
          habit_id: id,
          shared_by: userId,
        })),
        { onConflict: "group_id,habit_id", ignoreDuplicates: true },
      );
  }

  return "done";
}

/**
 * A camera take waiting to be sent: the file, and everything the send would
 * have handed `share_capture`.
 */
export type CaptureSharePayload = ShareCaptureParams & {
  /**
   * The take itself, as bytes rather than the Blob it came as: Safari's
   * IndexedDB has had releases that couldn't keep a Blob, and bytes store
   * everywhere.
   */
  media: ArrayBuffer;
  contentType: string;
};

/**
 * Keep a take to send once the connection is back.
 *
 * `payload.mediaPath` is minted before anything is sent, the same path an
 * online attempt used, so a take that reached storage before the connection
 * dropped is found there rather than uploaded twice.
 *
 * A private take may be queued, unlike a private check-in (see
 * `PrivateOfflineError`): those go to the completions queue, which a service
 * worker from before 039 can drain without the private flag. Only the page
 * replays the outbox, and the code that queued a take is the code that sends
 * it.
 */
export function queueCaptureShare(entry: {
  id: string;
  userId: string;
  payload: CaptureSharePayload;
}): Promise<void> {
  return queueWrite({ ...entry, kind: "capture.share" });
}

/** Storage refuses a second upload to a path as a 409, "already exists". */
function isAlreadyUploaded(error: { statusCode?: unknown }): boolean {
  return String(error.statusCode) === "409";
}

/**
 * The rows `share_capture` makes that carry this take's path — one is enough.
 *
 * A habit always gets its row, where a friend or group the habit's check-in
 * already reaches is skipped, so the habits are the ones to ask about.
 */
function rowCarrying(supabase: Client, userId: string, p: CaptureSharePayload) {
  if (p.habitIds.length > 0) {
    return p.isPrivate
      ? supabase
          .from("completion_private_content")
          .select("completion_id")
          .eq("user_id", userId)
          .eq("evidence_url", p.mediaPath)
          .limit(1)
      : supabase
          .from("completions")
          .select("id")
          .eq("user_id", userId)
          .eq("evidence_url", p.mediaPath)
          .limit(1);
  }
  if (p.friendIds.length > 0) {
    return supabase
      .from("encouragements")
      .select("id")
      .eq("user_id", userId)
      .eq("media_path", p.mediaPath)
      .limit(1);
  }
  return supabase
    .from("group_messages")
    .select("id")
    .eq("user_id", userId)
    .eq("media_path", p.mediaPath)
    .limit(1);
}

/**
 * Send a queued take the way the online path does: upload, then
 * `share_capture`.
 *
 * The upload repeats safely — a second one to the same path is refused as
 * already there. That refusal means an earlier attempt got at least that far,
 * and may have sent it too before being cut off, ahead of taking the row off
 * the queue. `share_capture` writes every row in one transaction, so one row
 * carrying the path means it all landed, and sending again would only
 * duplicate it.
 */
async function replayCaptureShare(
  supabase: Client,
  userId: string,
  p: CaptureSharePayload,
): Promise<ReplayOutcome> {
  const { error: uploadError } = await supabase.storage
    .from("completions")
    .upload(p.mediaPath, new Blob([p.media], { type: p.contentType }), {
      contentType: p.contentType,
    });

  if (uploadError) {
    // Too large stays too large. Anything else — offline again, storage
    // down, a session not yet refreshed — is worth another try, and
    // MAX_ATTEMPTS bounds how many.
    if (!isAlreadyUploaded(uploadError)) {
      return isUploadTooLarge(uploadError) ? "permanent" : "transient";
    }
    const { data, error } = await rowCarrying(supabase, userId, p);
    if (error) return "transient";
    if (data.length > 0) return "done";
  }

  const { error } = await untypedRpc(supabase, "share_capture", {
    p_media_path: p.mediaPath,
    p_media_type: p.mediaType,
    p_caption: p.caption ?? null,
    p_habit_ids: p.habitIds,
    p_friend_ids: p.friendIds,
    p_group_ids: p.groupIds,
    p_private: p.isPrivate ?? false,
  });
  if (!error) return "done";
  return isPermanent(error) ? "permanent" : "transient";
}

async function replayOne(
  supabase: Client,
  row: OutboxRecord,
): Promise<ReplayOutcome> {
  switch (row.kind) {
    case "habit.create":
      return replayHabitCreate(
        supabase,
        row.id,
        row.userId,
        row.payload as HabitCreatePayload,
      );

    case "habit.update": {
      const { habitId, patch } = row.payload as {
        habitId: string;
        patch: Database["public"]["Tables"]["habits"]["Update"];
      };
      // Patch semantics, so replaying a stale edit only overwrites the fields
      // the user actually touched.
      const { error } = await supabase
        .from("habits")
        .update(patch)
        .eq("id", habitId)
        .eq("user_id", row.userId);
      if (!error) return "done";
      return isPermanent(error) ? "permanent" : "transient";
    }

    case "encouragement.create": {
      const { error } = await supabase
        .from("encouragements")
        .insert({
          ...(row.payload as Database["public"]["Tables"]["encouragements"]["Insert"]),
          id: row.id,
          user_id: row.userId,
        });
      if (!error || error.code === UNIQUE_VIOLATION) return "done";
      return isPermanent(error) ? "permanent" : "transient";
    }

    case "encouragement.delete": {
      const { encouragementId } = row.payload as { encouragementId: string };
      // Deleting something already gone is a no-op, so this replays safely.
      const { error } = await supabase
        .from("encouragements")
        .delete()
        .eq("id", encouragementId)
        .eq("user_id", row.userId);
      if (!error) return "done";
      return isPermanent(error) ? "permanent" : "transient";
    }

    case "capture.share":
      return replayCaptureShare(
        supabase,
        row.userId,
        row.payload as CaptureSharePayload,
      );
  }
}

export interface OutboxReplayResult {
  applied: number;
  dropped: number;
}

/**
 * Replay this user's queued writes, oldest first.
 *
 * Order matters: an edit queued behind a create must not overtake it, or it
 * would patch a row that does not exist yet.
 */
export async function replayOutbox(
  supabase: Client,
  userId: string,
): Promise<OutboxReplayResult> {
  const rows = await claimOutbox(userId);
  if (rows.length === 0) return { applied: 0, dropped: 0 };

  const done: string[] = [];
  const dropped: string[] = [];
  const retry: string[] = [];
  let lastError: string | undefined;

  for (const [index, row] of rows.entries()) {
    let outcome: ReplayOutcome;
    try {
      outcome = await replayOne(supabase, row);
    } catch (err) {
      outcome = isOfflineError(err) ? "transient" : "permanent";
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (outcome === "done") {
      done.push(row.id);
      continue;
    }
    if (outcome === "permanent" || (row.attempts ?? 0) + 1 >= MAX_ATTEMPTS) {
      dropped.push(row.id);
      continue;
    }

    // Transient: stop here and keep the rest, so ordering is preserved.
    retry.push(...rows.slice(index).map((r) => r.id));
    break;
  }

  await deleteOutbox([...done, ...dropped]);
  await releaseOutbox(retry, lastError);

  return { applied: done.length, dropped: dropped.length };
}
