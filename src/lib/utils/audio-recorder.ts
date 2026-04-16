/**
 * Cross-browser MIME type detection for audio recording via MediaRecorder.
 *
 * Tries preferred codecs in order and returns the first supported type,
 * or `null` if MediaRecorder is not available.
 */

const CANDIDATES = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/mp4", extension: "m4a" }, // Safari / iOS
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
] as const;

export function getSupportedAudioMimeType(): {
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
