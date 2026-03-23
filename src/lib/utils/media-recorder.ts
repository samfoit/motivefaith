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

export function getSupportedMimeType(): {
  mimeType: string;
  extension: string;
} | null {
  if (typeof MediaRecorder === "undefined") return null;

  for (const candidate of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return { mimeType: candidate.mimeType, extension: candidate.extension };
    }
  }

  return null;
}
