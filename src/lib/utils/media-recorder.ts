/**
 * Cross-browser MIME type detection for MediaRecorder.
 *
 * Tries preferred codecs in order and returns the first supported type,
 * or `null` if MediaRecorder is not available.
 */

const CANDIDATES = [
  { mimeType: "video/webm;codecs=vp9", extension: "webm" },
  { mimeType: "video/webm;codecs=vp8", extension: "webm" },
  { mimeType: "video/webm", extension: "webm" },
  { mimeType: "video/mp4", extension: "mp4" }, // Safari
] as const;

/**
 * For re-encoding a video picked from the camera roll (see transcode-video).
 * A picked video is often already an MP4 that plays everywhere, and
 * re-encoding it must not turn it into something the phone on the other end
 * can't play.
 *
 * H.264 with AAC in MP4 first: every browser and phone plays it. Then WebM,
 * which iPhones play from iOS 17.4. An MP4 whose sound isn't named comes
 * last: Chrome on Android can record H.264 without AAC, and its MP4 would
 * carry Opus, which an iPhone may play with no sound. Safari, which reaches
 * that last entry only before it could record WebM, puts AAC in it.
 */
const TRANSCODE_CANDIDATES = [
  { mimeType: "video/mp4;codecs=avc1,mp4a.40.2", extension: "mp4" },
  { mimeType: "video/webm;codecs=vp9", extension: "webm" },
  { mimeType: "video/webm;codecs=vp8", extension: "webm" },
  { mimeType: "video/webm", extension: "webm" },
  { mimeType: "video/mp4", extension: "mp4" },
] as const;

function firstSupported(
  candidates: readonly { mimeType: string; extension: string }[],
): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === "undefined") return null;

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return { mimeType: candidate.mimeType, extension: candidate.extension };
    }
  }

  return null;
}

export function getSupportedMimeType(): {
  mimeType: string;
  extension: string;
} | null {
  return firstSupported(CANDIDATES);
}

export function getTranscodeMimeType(): {
  mimeType: string;
  extension: string;
} | null {
  return firstSupported(TRANSCODE_CANDIDATES);
}
