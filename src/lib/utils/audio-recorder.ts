/**
 * Cross-browser MIME type detection for audio recording via MediaRecorder.
 *
 * Tries preferred codecs in order and returns the first supported type,
 * or `null` if MediaRecorder is not available.
 */

import { isWebKit } from "@/lib/utils/browser";

const WEBM_OPUS = { mimeType: "audio/webm;codecs=opus", extension: "webm" };
const WEBM = { mimeType: "audio/webm", extension: "webm" };
const MP4 = { mimeType: "audio/mp4", extension: "m4a" };
const OGG_OPUS = { mimeType: "audio/ogg;codecs=opus", extension: "ogg" };

const CANDIDATES = [WEBM_OPUS, WEBM, MP4, OGG_OPUS] as const;

/**
 * MP4 first on WebKit. Since iOS 18.4 Safari's recorder also takes WebM, but
 * its own WebM player gives Web Audio nothing to read, so the review's meter
 * sat flat while the take played, and the file carries no length, so a note
 * showed no time until all of it had downloaded. Its MP4 (AAC) has neither
 * problem and plays everywhere.
 */
const WEBKIT_CANDIDATES = [MP4, WEBM_OPUS, WEBM, OGG_OPUS] as const;

export function getSupportedAudioMimeType(): {
  mimeType: string;
  extension: string;
} | null {
  if (typeof MediaRecorder === "undefined") return null;

  for (const candidate of isWebKit() ? WEBKIT_CANDIDATES : CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return { mimeType: candidate.mimeType, extension: candidate.extension };
    }
  }

  return null;
}
