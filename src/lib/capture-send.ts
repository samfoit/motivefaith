import { createClient } from "@/lib/supabase/client";
import { isOfflineError, queueCaptureShare } from "@/lib/offline-write";
import { notifyPendingChanged } from "@/lib/outbox-drain";
import { compressImage } from "@/lib/utils/compress-image";
import { MIME_TO_EXT } from "@/lib/utils/media-types";
import { MAX_GIF_SIZE_MB } from "@/lib/constants/limits";
import type {
  ShareCaptureParams,
  ShareCaptureResult,
} from "@/lib/hooks/useShareCapture";

/**
 * The two halves of sending a photo, video or voice note, shared by the
 * camera flow and a chat's own attach button: getting the file ready to
 * upload, then uploading it and making its rows — or keeping it for later.
 */

export interface PreparedCapture {
  /** Names the file, and the outbox row if the send has to wait. */
  id: string;
  blob: Blob;
  contentType: string;
  /** Where it goes in the `completions` bucket. */
  mediaPath: string;
}

/** Whether a GIF is small enough to be sent as it is, still moving. */
export function gifFits(file: Blob): boolean {
  return file.size <= MAX_GIF_SIZE_MB * 1024 * 1024;
}

/**
 * The bytes to upload for a take, and the path they go to.
 *
 * A photo is shrunk and re-encoded as WebP. A GIF is not: drawing it to a
 * canvas keeps only its first frame, so it goes up untouched and stays
 * animated — unless it is over MAX_GIF_SIZE_MB, when a still is what's left
 * to send. Video and voice go as recorded.
 *
 * The id is minted here, before anything is sent, so a take that has to be
 * queued keeps the path it may already have reached storage under. A private
 * take goes where no shared row can point (039).
 */
export async function prepareCapture(
  file: File,
  mode: "photo" | "video" | "voice",
  userId: string,
  isPrivate = false,
): Promise<PreparedCapture> {
  // The bare type: a recorder's "video/webm;codecs=vp9" is neither in
  // MIME_TO_EXT nor in the bucket's allowed types.
  let blob: Blob = file;
  let contentType = file.type.split(";")[0];
  let ext = MIME_TO_EXT[contentType] ?? "bin";

  if (mode === "photo" && !(contentType === "image/gif" && gifFits(file))) {
    blob = await compressImage(file);
    ext = "webp";
    contentType = "image/webp";
  }

  const id = crypto.randomUUID();
  return {
    id,
    blob,
    contentType,
    mediaPath: `${userId}/${isPrivate ? "private" : "capture"}/${id}.${ext}`,
  };
}

/**
 * Upload a prepared take and make its rows, or, without a connection, keep
 * it in the outbox to send once there is one.
 *
 * Uploaded once; every destination row points at the path, and those rows
 * are what let a friend or group member read it (migration 034). Offline it
 * is kept without trying, as a check-in is, and so is a send the connection
 * drops partway. A refusal from the server is still an error to show, not a
 * promise to send later, so it is thrown.
 */
export async function deliverCapture({
  prepared,
  userId,
  share,
  shareNow,
}: {
  prepared: PreparedCapture;
  userId: string;
  share: ShareCaptureParams;
  /** `share_capture`, as the caller's mutation runs it. */
  shareNow: (share: ShareCaptureParams) => Promise<ShareCaptureResult | null | undefined>;
}): Promise<
  | { queued: true }
  | { queued: false; result: ShareCaptureResult | null }
> {
  const { id, blob, contentType } = prepared;

  if (navigator.onLine) {
    try {
      const { error: uploadError } = await createClient()
        .storage.from("completions")
        .upload(share.mediaPath, blob, { contentType });

      if (uploadError) throw uploadError;

      return { queued: false, result: (await shareNow(share)) ?? null };
    } catch (err) {
      if (!isOfflineError(err)) throw err;
    }
  }

  await queueCaptureShare({
    id,
    userId,
    payload: { ...share, media: await blob.arrayBuffer(), contentType },
  });
  notifyPendingChanged();
  return { queued: true };
}
