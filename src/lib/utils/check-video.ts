import { ALLOWED_VIDEO_TYPES } from "@/lib/utils/media-types";
import { MAX_VIDEO_DURATION_S, MAX_VIDEO_SIZE_MB } from "@/lib/constants/limits";

/**
 * Checks for a video picked from the camera roll, made before it is uploaded.
 *
 * The camera holds its own takes to MAX_VIDEO_DURATION_S, but a picked video
 * can be any length and size. Where the phone can, it is trimmed and shrunk
 * to fit (transcode-video). Where it can't, it goes as it is, and has to fit
 * as it is: the storage bucket enforces the size, but only once the whole
 * file has gone up, and nothing on the server can read a length — so both are
 * checked here, as the video is picked.
 */

interface Box {
  contentStart: number;
  end: number;
}

/**
 * A real file has a handful of boxes at each level; past this many, it is not
 * one worth reading on, and walking it one small read at a time would hold
 * the pick up.
 */
const MAX_BOXES = 256;

async function readBytes(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

/** Unsigned 64-bit, as a number: exact up to 2^53, far past any real file. */
function getUint64(view: DataView, at: number): number {
  return view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4);
}

/**
 * The first box of `type` among the MP4 / QuickTime boxes laid end to end in
 * [start, end). Walks the box headers only, so a moov stored after gigabytes
 * of media costs a few small reads, not a read of the file.
 */
async function findBox(
  file: Blob,
  start: number,
  end: number,
  type: string,
): Promise<Box | null> {
  let offset = start;
  for (let i = 0; i < MAX_BOXES && offset + 8 <= end; i++) {
    const head = await readBytes(file, offset, Math.min(offset + 16, end));
    const boxType = String.fromCharCode(
      head.getUint8(4),
      head.getUint8(5),
      head.getUint8(6),
      head.getUint8(7),
    );
    let size = head.getUint32(0);
    let headerSize = 8;
    if (size === 1) {
      // The real size follows the type, for boxes over 4 GB.
      if (head.byteLength < 16) return null;
      size = getUint64(head, 8);
      headerSize = 16;
    } else if (size === 0) {
      // The last box, running to the end.
      size = end - offset;
    }
    if (size < headerSize) return null; // not an MP4 / QuickTime file
    if (boxType === type) {
      return { contentStart: offset + headerSize, end: Math.min(offset + size, end) };
    }
    offset += size;
  }
  return null;
}

/**
 * A video's length in seconds, read from its MP4 / QuickTime header (the
 * movie header, `mvhd`) — the formats phones save to the camera roll. Null
 * for anything else, such as WebM, or a file whose header has no length.
 *
 * Read from the bytes rather than by loading the file into a video element:
 * iOS Safari's media events for a picked file's blob URL have been unreliable
 * across releases, and this has to work on an iPhone above all.
 */
export async function readVideoDuration(file: Blob): Promise<number | null> {
  try {
    const moov = await findBox(file, 0, file.size, "moov");
    if (!moov) return null;
    const mvhd = await findBox(file, moov.contentStart, moov.end, "mvhd");
    if (!mvhd) return null;

    const header = await readBytes(
      file,
      mvhd.contentStart,
      Math.min(mvhd.contentStart + 32, mvhd.end),
    );
    // Version 1 widens the times and the duration to 64 bits.
    const version = header.getUint8(0);
    const timescale = header.getUint32(version === 1 ? 20 : 12);
    const unknown =
      version === 1
        ? header.getUint32(24) === 0xffffffff && header.getUint32(28) === 0xffffffff
        : header.getUint32(16) === 0xffffffff;
    const duration = version === 1 ? getUint64(header, 24) : header.getUint32(16);

    if (unknown || timescale === 0 || duration === 0) return null;
    return duration / timescale;
  } catch {
    // Truncated or not what it claimed to be: no length to go on.
    return null;
  }
}

/**
 * Why a picked video can't be sent, as a sentence for the person who picked
 * it, or null when it can. A video whose length can't be read is held to the
 * size limit alone.
 */
export async function checkVideo(file: File): Promise<string | null> {
  if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
    return "Unsupported video type. Use MP4, MOV, or WebM.";
  }

  const duration = await readVideoDuration(file);
  // Compared as shown, so a 15.4 s clip passes and the message never says
  // "15" about a video it refused for being longer than 15.
  const seconds = duration === null ? null : Math.round(duration);
  if (seconds !== null && seconds > MAX_VIDEO_DURATION_S) {
    return `Videos can be up to ${MAX_VIDEO_DURATION_S} seconds. This one is ${seconds}.`;
  }

  if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
    const mb = Math.ceil(file.size / (1024 * 1024));
    return `Videos can be up to ${MAX_VIDEO_SIZE_MB} MB. This one is ${mb} MB — try a shorter clip.`;
  }

  return null;
}

/**
 * Whether an upload was refused for its size. The pick-time check should stop
 * such a file first; this catches the bucket's limit and MAX_VIDEO_SIZE_MB
 * drifting apart, where "try again" would only fail again.
 */
export function isUploadTooLarge(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    String(err.statusCode) === "413"
  );
}
