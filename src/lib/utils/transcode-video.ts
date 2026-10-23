import { getTranscodeMimeType } from "@/lib/utils/media-recorder";
import { MAX_VIDEO_SIZE_MB } from "@/lib/constants/limits";

/**
 * Trims and shrinks a video picked from the camera roll on the phone, before
 * it is uploaded: the part chosen, redrawn at 720p and recorded at a fixed
 * bitrate, so it comes out at about 5 MB whatever the phone shot it at.
 *
 * It is the camera's own pipeline (see CameraCapture): the video plays into a
 * canvas, and the canvas, with the video's sound taken through Web Audio, is
 * recorded with MediaRecorder. So it runs in real time, a 15 s piece taking
 * 15 s, but it needs nothing the camera doesn't already.
 */

/** The output's long side: 720p, plenty for a chat bubble or a phone screen. */
const MAX_LONG_SIDE = 1280;
/** With the sound, about 4.9 MB for 15 seconds. */
const VIDEO_BITS_PER_SECOND = 2_500_000;
const AUDIO_BITS_PER_SECOND = 128_000;
const FRAME_RATE = 30;
/** Playback that hasn't moved for this long has stalled for good. */
const STALL_MS = 5000;
/** How long to wait for a suspended AudioContext before giving up on it. */
const AUDIO_START_MS = 1000;

export type TranscodeFailure =
  /** This browser can't record a canvas with sound. */
  | "unsupported"
  /** The browser can't play the video, or stopped partway. */
  | "decode"
  | "cancelled"
  /** The app went to the background and playback couldn't pick up again. */
  | "interrupted"
  /** Came out over MAX_VIDEO_SIZE_MB anyway. */
  | "too-large"
  | "failed";

export class TranscodeError extends Error {
  readonly reason: TranscodeFailure;

  constructor(reason: TranscodeFailure) {
    super(`Video could not be prepared: ${reason}`);
    this.name = "TranscodeError";
    this.reason = reason;
  }
}

export interface TranscodeOptions {
  /** Where the piece starts in the video, in seconds. */
  start: number;
  /** The piece's length in seconds; it ends sooner if the video does. */
  length: number;
  /** 0 to 1 as the piece plays through, at most once per percent. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Whether this browser has everything transcodeVideo needs. */
export function canTranscodeVideo(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.AudioContext === "function" &&
    typeof AudioContext.prototype.createMediaStreamDestination === "function" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    getTranscodeMimeType() !== null
  );
}

/**
 * The output frame: the video's own shape with its long side at most `max`,
 * never enlarged, and both sides even, which some encoders insist on.
 */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_LONG_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}

/**
 * Re-encode `length` seconds of `source` from `start`.
 *
 * Call it straight from the tap that asked for it, not after an await. It
 * plays the video with sound, which iOS allows only for a media element that
 * was first played during a tap, and it starts its AudioContext for the same
 * reason; everything before its first await runs inside that tap.
 */
export function transcodeVideo(source: Blob, options: TranscodeOptions): Promise<File> {
  const format = getTranscodeMimeType();
  if (!format || !canTranscodeVideo()) {
    return Promise.reject(new TranscodeError("unsupported"));
  }

  // --- Inside the tap ---
  const audio = new AudioContext();
  void audio.resume().catch(() => {});

  const url = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  // In the page but out of sight: iOS may not hand a canvas the frames of a
  // video that isn't in the document.
  Object.assign(video.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  video.src = url;
  document.body.appendChild(video);
  // Played and paused at once: that is what lets the real play(), later and
  // with sound, through on iOS. The interrupted play() rejects; that's fine.
  video.play().catch(() => {});
  video.pause();

  return run(video, audio, format, options).finally(() => {
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
    void audio.close().catch(() => {});
  });
}

/** Resolves on the video's `event`; rejects on its error, or on a cancel. */
function next(video: HTMLVideoElement, event: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (outcome: () => void) => () => {
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      outcome();
    };
    const onEvent = settle(resolve);
    const onError = settle(() => reject(new TranscodeError("decode")));
    const onAbort = settle(() => reject(new TranscodeError("cancelled")));

    if (signal?.aborted) return onAbort();
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
  });
}

async function run(
  video: HTMLVideoElement,
  audio: AudioContext,
  format: { mimeType: string; extension: string },
  { start, length, onProgress, signal }: TranscodeOptions,
): Promise<File> {
  if (signal?.aborted) throw new TranscodeError("cancelled");
  if (video.error) throw new TranscodeError("decode");
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await next(video, "loadedmetadata", signal);
  }
  // No picture: a format the browser can open but not draw, such as HEVC
  // where there's no decoder for it.
  if (!video.videoWidth || !video.videoHeight) throw new TranscodeError("decode");

  const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
  const from = Math.min(Math.max(0, start), duration);
  const until = Math.min(from + length, duration);
  if (from > 0) {
    video.currentTime = from;
    await next(video, "seeked", signal);
  }

  // The tap's resume() is normally done by now. A context still suspended
  // would record silence, which is worse than not sending it this way.
  const running = () => audio.state === "running";
  if (!running()) {
    await Promise.race([
      audio.resume().catch(() => {}),
      new Promise((r) => setTimeout(r, AUDIO_START_MS)),
    ]);
    if (!running()) throw new TranscodeError("failed");
  }

  const size = fitWithin(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new TranscodeError("unsupported");

  // The sound goes to the recorder, not the speaker: nothing is connected to
  // audio.destination, so the piece plays through silently.
  const sound = audio.createMediaElementSource(video);
  const sink = audio.createMediaStreamDestination();
  sound.connect(sink);
  const stream = new MediaStream([
    ...canvas.captureStream(FRAME_RATE).getVideoTracks(),
    ...sink.stream.getAudioTracks(),
  ]);

  try {
    return await record({ video, ctx, size, stream, format, from, until, onProgress, signal });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    sound.disconnect();
  }
}

interface RecordJob {
  video: HTMLVideoElement;
  ctx: CanvasRenderingContext2D;
  size: { width: number; height: number };
  stream: MediaStream;
  format: { mimeType: string; extension: string };
  from: number;
  until: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function record({
  video,
  ctx,
  size,
  stream,
  format,
  from,
  until,
  onProgress,
  signal,
}: RecordJob): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    const recorder = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    const chunks: Blob[] = [];
    let frame: number | null = null;
    let settled = false;
    let percent = -1;
    let lastTime = video.currentTime;
    let lastMoved = performance.now();

    const report = (fraction: number) => {
      const p = Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
      if (p === percent) return;
      percent = p;
      onProgress?.(p / 100);
    };

    const stopDrawing = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };

    const detach = () => {
      stopDrawing();
      video.pause();
      video.removeEventListener("ended", finish);
      video.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      signal?.removeEventListener("abort", onAbort);
    };

    const fail = (reason: TranscodeFailure) => {
      if (settled) return;
      settled = true;
      detach();
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      reject(new TranscodeError(reason));
    };

    function finish() {
      if (settled) return;
      detach();
      if (recorder.state === "inactive") {
        fail("failed");
        return;
      }
      // onstop, after the last chunk, settles it.
      recorder.stop();
    }

    function onError() {
      fail("decode");
    }

    function onAbort() {
      fail("cancelled");
    }

    // Backgrounded, a phone stops the video and the drawing; the recorder is
    // paused with them so the take doesn't fill with a frozen frame.
    function onVisibility() {
      if (document.hidden) {
        stopDrawing();
        video.pause();
        if (recorder.state === "recording") {
          if (typeof recorder.pause !== "function") return fail("interrupted");
          recorder.pause();
        }
      } else if (recorder.state === "paused") {
        video.play().then(
          () => {
            if (settled) return;
            recorder.resume();
            lastMoved = performance.now();
            draw();
          },
          () => fail("interrupted"),
        );
      }
    }

    function draw() {
      ctx.drawImage(video, 0, 0, size.width, size.height);
      const now = performance.now();
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastMoved = now;
      } else if (now - lastMoved > STALL_MS) {
        return fail("decode");
      }
      report(until > from ? (video.currentTime - from) / (until - from) : 1);
      if (video.currentTime >= until) return finish();
      frame = requestAnimationFrame(draw);
    }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => fail("failed");
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      // The bare type: the codecs a recorder tags on are of no use past here.
      const type = format.mimeType.split(";")[0];
      const blob = new Blob(chunks, { type });
      if (blob.size === 0) return reject(new TranscodeError("failed"));
      if (blob.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
        return reject(new TranscodeError("too-large"));
      }
      report(1);
      resolve(new File([blob], `video-${Date.now()}.${format.extension}`, { type }));
    };

    if (signal?.aborted) return onAbort();
    video.addEventListener("ended", finish);
    video.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);
    signal?.addEventListener("abort", onAbort);

    ctx.drawImage(video, 0, 0, size.width, size.height);
    report(0);
    video.play().then(
      () => {
        if (settled) return;
        // Started once the video is moving, so the take doesn't open on a
        // held frame.
        recorder.start();
        lastMoved = performance.now();
        draw();
      },
      () => fail("failed"),
    );
  });
}
