"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { X, RotateCcw, Image as ImageIcon, Check, Maximize2, Minimize2, Mic, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { useCamera } from "@/lib/hooks/useCamera";
import { useCameraGestures } from "@/lib/hooks/useCameraGestures";
import { useVoiceRecording } from "@/lib/hooks/useVoiceRecording";
import { VoiceMeter } from "@/components/habits/VoiceMeter";
import { VoicePlayback } from "@/components/habits/VoicePlayback";
import { VideoTrimBar } from "@/components/habits/VideoTrimBar";
import { PrivateToggle } from "@/components/habits/PrivateToggle";
import { getSupportedMimeType } from "@/lib/utils/media-recorder";
import { MIME_TO_EXT } from "@/lib/utils/media-types";
import { checkVideo, readVideoDuration } from "@/lib/utils/check-video";
import { canTranscodeVideo, transcodeVideo, TranscodeError } from "@/lib/utils/transcode-video";
import { MAX_AUDIO_DURATION_S, MAX_VIDEO_DURATION_S } from "@/lib/constants/limits";
import { elementAspect, viewfinderCrop } from "@/lib/utils/viewfinder-crop";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CaptureStage = "viewfinder" | "recording" | "review";

/**
 * What the shutter makes. Photo is the default and still records a video on
 * a hold, the way the system camera's does; Video starts a take on a tap, so
 * nobody has to hold for it; Voice is a voice note with no camera.
 */
type CaptureMode = "video" | "photo" | "voice";

export interface CameraCaptureProps {
  /**
   * Hands the take on. A caller that sends it from the review itself, as a
   * habit's check-in does, returns a promise: the review stays up under
   * "Uploading…" until it settles, and a rejection's message is shown on it,
   * with the take still there to send again or retake.
   */
  onCapture: (file: File, notes?: string) => void | Promise<void>;
  onClose: () => void;
  onFallback: () => void;
  maxVideoDuration?: number;
  maxVoiceDuration?: number;
  /**
   * Reopen on the review screen with an earlier take — how the send screen's
   * back button returns to the full-size preview instead of starting over.
   * The camera itself only starts if the user retakes.
   */
  initialCapture?: { file: File; notes?: string };
  /**
   * Offer the Voice mode beside the camera. Off where voice has its own way
   * in, as on a habit's sheet, so the camera only makes photos and videos.
   */
  allowVoice?: boolean;
  /**
   * The review screen's confirm button, in place of "Use Photo", for a take
   * that goes straight on from there: "Send to Sam" when the camera was
   * opened from a chat, "Submit" for a habit's check-in.
   */
  useLabel?: string;
  /**
   * Offers the private switch on the review, for a check-in whose photo or
   * video can be kept out of partners' view. Absent hides it.
   */
  privacy?: {
    isPrivate: boolean;
    onChange: (isPrivate: boolean) => void;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ms threshold — taps shorter than this capture a photo */
const HOLD_THRESHOLD_MS = 250;

/** Dragging up from the shutter this far sweeps the entire zoom range. */
const SHUTTER_ZOOM_TRAVEL_PX = 180;
/** Movement under this is still a press, not a zoom drag. */
const SHUTTER_DRAG_SLOP_PX = 10;

const RING_RADIUS = 36;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * How the live camera sits in the viewfinder. "fill" covers the screen and
 * trims the camera's overflow; "fit" shows the camera's whole frame. Either
 * way the capture is exactly what is on screen (see viewfinderCrop).
 */
type Framing = "fit" | "fill";
const FRAMING_KEY = "camera-framing";

/**
 * The gestures are taught by a tip over the viewfinder for the first few
 * opens, then left to memory, rather than spelled out under the shutter on
 * every open.
 */
const COACH_KEY = "camera-coach-opens";
const COACH_OPENS = 3;
const COACH_MS = 4000;

/** Long enough to read why a picked video was turned away. */
const NOTICE_MS = 6000;

function coachOpens(): number {
  try {
    return Number(localStorage.getItem(COACH_KEY)) || 0;
  } catch {
    // Storage blocked: no tip rather than one on every open.
    return COACH_OPENS;
  }
}

function countCoachOpen() {
  try {
    localStorage.setItem(COACH_KEY, String(coachOpens() + 1));
  } catch {
    // Not counted; coachOpens() already treats blocked storage as done.
  }
}

const MODES: readonly { id: CaptureMode; label: string }[] = [
  { id: "video", label: "Video" },
  { id: "photo", label: "Photo" },
  { id: "voice", label: "Voice" },
];

/**
 * Only a mouse or trackpad device gets the choice. A phone's or tablet's
 * camera is shaped for its own screen and full-bleed is what a camera app
 * looks like there; the control would be clutter. On a laptop a 4:3 webcam
 * filling a wide display loses most of its height, so it earns its place.
 */
function canChooseFraming(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * Touch devices always fill. Otherwise the remembered choice, else "fit" on
 * a landscape screen and "fill" on a portrait one.
 */
function initialFraming(): Framing {
  if (!canChooseFraming()) return "fill";
  try {
    const saved = localStorage.getItem(FRAMING_KEY);
    if (saved === "fit" || saved === "fill") return saved;
  } catch {
    // Storage blocked: fall through to the screen's shape.
  }
  return window.innerWidth > window.innerHeight ? "fit" : "fill";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * The modes as a row of words above the shutter, slid so the current one
 * sits over it, the way the system camera does. Takes the place of a
 * separate switch, and swiping the viewfinder moves along it too.
 */
function ModeStrip({
  modes,
  mode,
  hidden,
  onChange,
}: {
  modes: readonly { id: CaptureMode; label: string }[];
  mode: CaptureMode;
  /** Mid-take: keeps its height so the shutter does not jump. */
  hidden: boolean;
  onChange: (mode: CaptureMode) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
    const parent = strip?.parentElement;
    if (!strip || !active || !parent) return;
    const centre = () =>
      setOffset(parent.clientWidth / 2 - (active.offsetLeft + active.offsetWidth / 2));
    centre();
    window.addEventListener("resize", centre);
    return () => window.removeEventListener("resize", centre);
  }, [mode]);

  return (
    <div
      className={cn("w-full h-8 overflow-hidden", hidden && "invisible")}
      aria-hidden={hidden || undefined}
    >
      <div
        ref={stripRef}
        role="radiogroup"
        aria-label="Capture mode"
        className="inline-flex h-full items-center gap-5 motion-safe:transition-transform motion-safe:duration-200 ease-out"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            data-mode={m.id}
            aria-checked={mode === m.id}
            tabIndex={hidden ? -1 : undefined}
            onClick={() => onChange(m.id)}
            className={cn(
              "relative px-1 py-1 text-[13px] transition-colors rounded",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              mode === m.id ? "text-white font-semibold" : "text-white/45 font-medium",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CameraCapture({
  onCapture,
  onClose,
  onFallback,
  maxVideoDuration = MAX_VIDEO_DURATION_S,
  maxVoiceDuration = MAX_AUDIO_DURATION_S,
  initialCapture,
  allowVoice = true,
  useLabel,
  privacy,
}: CameraCaptureProps) {
  const {
    state,
    stream,
    facingMode,
    errorMessage,
    zoom,
    zoomRange,
    isOpticalZoom,
    requestCamera,
    switchCamera,
    setZoom,
    stopCamera,
  } = useCamera({ audio: true });

  const [mode, setMode] = useState<CaptureMode>(() => {
    const type = initialCapture?.file.type ?? "";
    if (type.startsWith("audio")) return "voice";
    if (type.startsWith("video")) return "video";
    return "photo";
  });
  const modes = allowVoice ? MODES : MODES.filter((m) => m.id !== "voice");
  const [stage, setStage] = useState<CaptureStage>(
    initialCapture ? "review" : "viewfinder",
  );
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(
    initialCapture?.file ?? null,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [notes, setNotes] = useState(initialCapture?.notes ?? "");
  const [isPressed, setIsPressed] = useState(false);
  const [framingChoice] = useState(canChooseFraming);
  // Not on a reopened review: that is the same visit, not a new open.
  const [coach, setCoach] = useState(() => !initialCapture && coachOpens() < COACH_OPENS);
  const coachCountedRef = useRef(false);
  /**
   * Why the last video picked from the gallery can't be used, or why the
   * take couldn't be sent.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * A video picked from the gallery, to be trimmed and shrunk when it is
   * used. Its length is null until something has been able to read it.
   */
  const [picked, setPicked] = useState<{ file: File; duration: number | null } | null>(null);
  /** Where the part of a long picked video to send starts, in seconds. */
  const [trimStart, setTrimStart] = useState(0);
  /** How far preparing a picked video has got, 0 to 1, while it runs. */
  const [preparing, setPreparing] = useState<number | null>(null);
  const prepareRef = useRef<AbortController | null>(null);
  /** The caller is sending the take from the review (see onCapture). */
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  /** The picked video's length, when it is longer than a video may be. */
  const trimDuration =
    picked?.duration != null && Math.round(picked.duration) > maxVideoDuration
      ? picked.duration
      : null;
  const [framing, setFraming] = useState<Framing>(initialFraming);
  /** The camera frame's width / height, once its first frame arrives. */
  const [frameAspect, setFrameAspect] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldingRef = useRef(false);
  const mirrorAnimRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  /** True when this very press is the one that opened the take. */
  const startedTakeRef = useRef(false);
  /** Whether the running take is canvas-backed, and so can survive a flip. */
  const canFlipMidTakeRef = useRef(false);

  const voice = useVoiceRecording({
    maxDuration: maxVoiceDuration,
    onFinish: (blob) => {
      setCapturedBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      setStage("review");
    },
  });
  const {
    status: voiceStatus,
    start: startVoice,
    pause: pauseVoice,
    resume: resumeVoice,
    cancel: cancelVoice,
  } = voice;

  /**
   * How much of the zoom we are applying ourselves. When the camera zooms in
   * hardware the picture already arrives cropped and this stays at 1.
   */
  const digitalZoom = isOpticalZoom ? 1 : zoom / zoomRange.min;

  // Gestures and the recording frame loop both run outside the render cycle,
  // so they read the live zoom and facing mode through refs rather than a
  // closure captured when the take started.
  const zoomRef = useRef(zoom);
  const digitalZoomRef = useRef(digitalZoom);
  const mirrorRef = useRef(facingMode === "user");
  useEffect(() => {
    zoomRef.current = zoom;
    digitalZoomRef.current = digitalZoom;
    mirrorRef.current = facingMode === "user";
  }, [zoom, digitalZoom, facingMode]);

  const pinchStartZoomRef = useRef(zoom);
  const shutterDragRef = useRef<{ y: number; zoom: number; dragged: boolean } | null>(null);

  // --- Request camera on mount ---
  // Not when reopening on a review: the camera light would come on behind a
  // still photo. handleRetake starts it if the user wants a new take.
  const startOnReviewRef = useRef(!!initialCapture);
  useEffect(() => {
    if (startOnReviewRef.current) return;
    requestCamera();
  }, [requestCamera]);

  // --- Preview for a reopened take ---
  // Minted in an effect, not in useState's initializer: Strict Mode's
  // mount → unmount → mount would revoke an initializer-made URL in the
  // cleanup below and then keep rendering the dead string.
  const initialFileRef = useRef(initialCapture?.file ?? null);
  useEffect(() => {
    const file = initialFileRef.current;
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, []);

  // --- First-opens tip ---
  // Counted once per open, through the ref, even when Strict Mode runs the
  // effect twice.
  useEffect(() => {
    if (!coach) return;
    if (!coachCountedRef.current) {
      coachCountedRef.current = true;
      countCoachOpen();
    }
    const t = setTimeout(() => setCoach(false), COACH_MS);
    return () => clearTimeout(t);
  }, [coach]);
  const showCoach =
    coach && stage === "viewfinder" && mode === "photo" && !isPressed && !notice;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // --- Voice mode lets go of the camera ---
  // Also catches a camera that was still starting when the mode switched,
  // which would otherwise light up behind the voice screen.
  useEffect(() => {
    if (mode === "voice" && stream) stopCamera();
  }, [mode, stream, stopCamera]);

  const switchMode = useCallback(
    (next: CaptureMode) => {
      if (next === mode || stage !== "viewfinder") return;
      if (next === "voice" && !allowVoice) return;
      setMode(next);
      // Photo and Video share the running camera; only Voice lets it go.
      if (next === "voice") stopCamera();
      else if (mode === "voice") requestCamera(facingMode);
    },
    [mode, stage, allowVoice, requestCamera, stopCamera, facingMode],
  );

  // --- Attach / detach stream on the viewfinder element ---
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (stream && stage !== "review") {
      el.srcObject = stream;
    } else {
      el.srcObject = null;
    }
  }, [stream, stage]);

  // --- Cleanup preview URL ---
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      stopCamera();
      prepareRef.current?.abort();
      if (mirrorAnimRef.current != null) cancelAnimationFrame(mirrorAnimRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    };
  }, [stopCamera]);

  // --- Photo capture ---
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Take only the part of the frame the viewfinder is showing — its cover
    // trim and the digital zoom — at the camera's own resolution for that
    // region rather than stretched back up to the sensor's.
    const { sx, sy, sw, sh } = viewfinderCrop(
      video.videoWidth,
      video.videoHeight,
      elementAspect(video),
      digitalZoomRef.current,
    );

    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror the captured photo when using front camera
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        setStage("review");
        stopCamera();
      },
      "image/jpeg",
      0.92,
    );
  }, [stopCamera, facingMode]);

  // --- Stop the offscreen redraw loop ---
  const stopMirrorLoop = useCallback(() => {
    if (mirrorAnimRef.current != null) {
      cancelAnimationFrame(mirrorAnimRef.current);
      mirrorAnimRef.current = null;
    }
  }, []);

  // --- Recording clock ---
  // Paused time is not recorded, so it does not count against the limit; the
  // clock holds its reading and picks up where it left off.
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // --- Finish the take and go to review ---
  const finishRecording = useCallback(() => {
    stopTimer();
    stopMirrorLoop();
    // Stopping flushes the last chunk and `onstop` moves us to review. This is
    // valid from a paused recorder too.
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setIsPaused(false);
    stopCamera();
  }, [stopTimer, stopMirrorLoop, stopCamera]);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setRecordingTime(elapsedRef.current);
      if (elapsedRef.current >= maxVideoDuration) finishRecording();
    }, 1000);
  }, [stopTimer, maxVideoDuration, finishRecording]);

  // --- Pause / resume ---
  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    // Safari before 14.1 has no pause(); there a tap ends the take instead of
    // holding it open, which is the closest thing that still works.
    if (typeof recorder.pause !== "function") {
      finishRecording();
      return;
    }

    recorder.pause();
    stopTimer();
    setIsPaused(true);
  }, [finishRecording, stopTimer]);

  const resumeRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;

    recorder.resume();
    setIsPaused(false);
    startTimer();
  }, [startTimer]);

  // --- Video recording ---
  const startRecording = useCallback(() => {
    if (!stream) return;

    const mimeInfo = getSupportedMimeType();
    if (!mimeInfo) {
      // Video recording not supported — fall back to photo
      capturePhoto();
      return;
    }

    chunksRef.current = [];

    // Every take is redrawn through an offscreen canvas rather than recording
    // the camera track directly. It is what lets the saved file agree with the
    // viewfinder — the front camera is mirrored on screen, and a digital zoom
    // is a crop only we are applying — and, more than that, it is what makes
    // the take survive a flip: the recorder is bound to the canvas, so the
    // camera underneath it can be swapped out mid-recording without the
    // recorder ever noticing. Each frame reads the live mirror and zoom, so
    // both follow whatever the user does while it runs.
    let recordStream = stream;
    const video = videoRef.current;
    canFlipMidTakeRef.current = false;

    if (video) {
      const mc = document.createElement("canvas");
      const ctx = mc.getContext("2d");

      if (ctx && typeof mc.captureStream === "function") {
        // The take has the viewfinder's shape, at the camera's resolution for
        // the region it shows. Fixed for the whole take — a canvas that
        // resized mid-recording would corrupt the file. Anything the camera
        // sends is fitted to it below, including the other camera's, which
        // need not have the same resolution or even the same aspect ratio.
        const shown = viewfinderCrop(
          video.videoWidth || 640,
          video.videoHeight || 480,
          elementAspect(video),
        );
        // Even sizes: some encoders reject odd frame dimensions.
        mc.width = Math.round(shown.sw / 2) * 2;
        mc.height = Math.round(shown.sh / 2) * 2;
        const frameAspect = mc.width / mc.height;

        const drawFrame = () => {
          const vw = video.videoWidth || mc.width;
          const vh = video.videoHeight || mc.height;

          // Trim to the take's shape, then crop again for the live zoom, so
          // the picture fills the frame without ever being stretched.
          const { sx, sy, sw, sh } = viewfinderCrop(
            vw,
            vh,
            frameAspect,
            digitalZoomRef.current,
          );

          ctx.save();
          if (mirrorRef.current) {
            ctx.translate(mc.width, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, mc.width, mc.height);
          ctx.restore();
          mirrorAnimRef.current = requestAnimationFrame(drawFrame);
        };
        mirrorAnimRef.current = requestAnimationFrame(drawFrame);

        // Combine the redrawn video track with the original audio tracks. The
        // audio track outlives a flip, which is why the swap leaves it alone.
        const redrawn = mc.captureStream(30);
        const combined = new MediaStream();
        redrawn.getVideoTracks().forEach((t) => combined.addTrack(t));
        stream.getAudioTracks().forEach((t) => combined.addTrack(t));
        recordStream = combined;
        canFlipMidTakeRef.current = true;
      }
    }

    const recorder = new MediaRecorder(recordStream, { mimeType: mimeInfo.mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stopMirrorLoop();
      const blob = new Blob(chunksRef.current, { type: mimeInfo.mimeType });
      const url = URL.createObjectURL(blob);
      setCapturedBlob(blob);
      setPreviewUrl(url);
      setStage("review");
    };

    recorder.start();
    setStage("recording");
    setIsPaused(false);
    elapsedRef.current = 0;
    setRecordingTime(0);
    startTimer();
  }, [stream, capturePhoto, startTimer, stopMirrorLoop]);

  // --- Snapchat-style tap/hold handlers ---
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (stage === "review") return;
    isHoldingRef.current = true;
    setIsPressed(true);
    startedTakeRef.current = false;

    // Hold the pointer so sliding up to zoom keeps reporting to the shutter
    // instead of being lost the moment the finger leaves the button.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    shutterDragRef.current = { y: e.clientY, zoom: zoomRef.current, dragged: false };

    // Only Photo's viewfinder arms the hold: once a take is open, a press on
    // the shutter is a tap to pause or resume, and Video starts on the tap.
    if (stage !== "viewfinder" || mode !== "photo") return;

    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (isHoldingRef.current) {
        startedTakeRef.current = true;
        startRecording();
      }
    }, HOLD_THRESHOLD_MS);
  }, [stage, mode, startRecording]);

  /** Sliding up the shutter zooms in, the way it does while recording. */
  const handleShutterMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = shutterDragRef.current;
      if (!drag) return;

      const travelled = drag.y - e.clientY; // up is positive
      if (!drag.dragged && Math.abs(travelled) < SHUTTER_DRAG_SLOP_PX) return;

      drag.dragged = true;
      const span = zoomRange.max - zoomRange.min;
      setZoom(drag.zoom + (travelled / SHUTTER_ZOOM_TRAVEL_PX) * span);
    },
    [zoomRange, setZoom],
  );

  const handlePointerUp = useCallback(() => {
    setIsPressed(false);

    // A press that turned into a zoom drag was never asking for anything else.
    const dragged = shutterDragRef.current?.dragged ?? false;
    const startedTake = startedTakeRef.current;
    shutterDragRef.current = null;
    startedTakeRef.current = false;
    isHoldingRef.current = false;

    if (holdTimerRef.current) {
      // Released before the hold threshold — take a photo
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (stage === "viewfinder" && !dragged) capturePhoto();
      return;
    }

    // Video's tap opens the take.
    if (stage === "viewfinder") {
      if (mode === "video" && !dragged) startRecording();
      return;
    }

    // A take held open in Photo ends when it is let go, the way the system
    // camera's does. Hands-free takes are what Video is for.
    if (startedTake) {
      if (stage === "recording") finishRecording();
      return;
    }

    // A take started in Video carries on after the hand comes off the
    // shutter; a later tap is what pauses it.
    if (stage !== "recording" || dragged) return;

    if (isPaused) resumeRecording();
    else pauseRecording();
  }, [stage, mode, capturePhoto, startRecording, finishRecording, isPaused, pauseRecording, resumeRecording]);

  const handlePointerCancel = useCallback(() => {
    setIsPressed(false);
    shutterDragRef.current = null;
    // A held take loses its finger here too: keep what was recorded.
    if (startedTakeRef.current && stage === "recording") finishRecording();
    startedTakeRef.current = false;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    isHoldingRef.current = false;
  }, [stage, finishRecording]);

  // --- Gallery pick ---
  const handleGalleryPick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so the same file can be re-selected — after trimming it, say
    e.target.value = "";
    if (!file) return;

    // The camera stops its own takes at the limit; a video from the gallery
    // can be any length or size. Where it can be trimmed and shrunk here, that
    // happens when it is used. Elsewhere it is sent as it is, so it has to fit
    // as it is, and is turned away now rather than at the end of its upload.
    const isVideo = file.type.startsWith("video/");
    const prepare = isVideo && canTranscodeVideo();
    if (isVideo && !prepare) {
      const problem = await checkVideo(file);
      if (problem) {
        setNotice(problem);
        return;
      }
    }
    const duration = prepare ? await readVideoDuration(file) : null;

    setNotice(null);
    setPicked(prepare ? { file, duration } : null);
    setTrimStart(0);
    setCapturedBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
    setStage("review");
    stopCamera();
  }, [stopCamera]);

  // --- Picked video: its length, and the part to send ---

  // A length the header didn't give (a WebM, say), once the preview knows it.
  const readPreviewDuration = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const { duration } = e.currentTarget;
    if (!Number.isFinite(duration)) return;
    setPicked((p) => (p && p.duration === null ? { ...p, duration } : p));
  }, []);

  // The preview of a long video plays only the part that will be sent, round
  // and round, wherever the player's own scrubber is taken.
  const keepToTrim = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (trimDuration === null) return;
      const v = e.currentTarget;
      if (v.currentTime >= trimStart + maxVideoDuration || v.currentTime < trimStart - 0.5) {
        v.currentTime = trimStart;
      }
    },
    [trimDuration, trimStart, maxVideoDuration],
  );

  const loopTrim = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (trimDuration === null) return;
      e.currentTarget.currentTime = trimStart;
      void e.currentTarget.play().catch(() => {});
    },
    [trimDuration, trimStart],
  );

  const moveTrim = useCallback((start: number) => {
    setTrimStart(start);
    const v = reviewVideoRef.current;
    if (!v) return;
    v.pause();
    // Near enough while dragging: a keyframe seek keeps up with the finger.
    if (typeof v.fastSeek === "function") v.fastSeek(start);
    else v.currentTime = start;
  }, []);

  const commitTrim = useCallback((start: number) => {
    setTrimStart(start);
    const v = reviewVideoRef.current;
    if (!v) return;
    v.currentTime = start;
    void v.play().catch(() => {});
  }, []);

  // --- Hand the take on ---
  const handOver = useCallback(
    (file: File, caption: string | undefined) => {
      stopCamera();
      const sent = onCapture(file, caption);
      if (!sent) return;
      // Set before React draws the overlay, so a second tap already landing
      // on the button can't send the take twice.
      sendingRef.current = true;
      setSending(true);
      setNotice(null);
      const settle = () => {
        sendingRef.current = false;
        setSending(false);
      };
      sent.then(settle, (err: unknown) => {
        settle();
        setNotice(err instanceof Error ? err.message : "Couldn't send. Try again.");
      });
    },
    [stopCamera, onCapture],
  );

  /**
   * Trim the picked video to its part and shrink it, then hand it on. Runs
   * from the Use tap itself: transcodeVideo has to start inside a tap.
   */
  const prepareVideo = useCallback(
    (file: File, caption: string | undefined) => {
      // A second tap before the overlay is up must not start a second run.
      if (prepareRef.current) return;
      const controller = new AbortController();
      prepareRef.current = controller;
      reviewVideoRef.current?.pause();
      setNotice(null);
      setPreparing(0);

      transcodeVideo(file, {
        start: trimDuration === null ? 0 : trimStart,
        length: maxVideoDuration,
        onProgress: setPreparing,
        signal: controller.signal,
      }).then(
        (prepared) => {
          prepareRef.current = null;
          setPreparing(null);
          handOver(prepared, caption);
        },
        async (err: unknown) => {
          prepareRef.current = null;
          setPreparing(null);
          if (err instanceof TranscodeError && err.reason === "cancelled") return;
          console.error("Couldn't prepare the video:", err);
          // Not shrunk here. If none of it had to be cut and it fits as it
          // is, it goes as it is, the way it would where this can't run.
          if (trimDuration === null && (await checkVideo(file)) === null) {
            handOver(file, caption);
            return;
          }
          setNotice(
            `This video couldn't be prepared here. Try another, or trim it to ${maxVideoDuration} seconds first.`,
          );
        },
      );
    },
    [trimDuration, trimStart, maxVideoDuration, handOver],
  );

  const cancelPreparing = useCallback(() => prepareRef.current?.abort(), []);

  // --- Retake ---
  const handleRetake = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    setPicked(null);
    setTrimStart(0);
    setNotice(null);
    setRecordingTime(0);
    setIsPaused(false);
    setNotes("");
    setStage("viewfinder");
    // A voice take goes back to voice mode, with the camera left off.
    if (mode === "voice") return;
    // Reopen whichever camera the take came from, not the default rear one.
    requestCamera(facingMode);
  }, [previewUrl, requestCamera, facingMode, mode]);

  // --- Use capture ---
  const handleUse = useCallback(() => {
    if (!capturedBlob || sendingRef.current) return;

    // A video picked from the gallery is trimmed and shrunk on the way out.
    if (picked && capturedBlob === picked.file) {
      prepareVideo(picked.file, notes.trim() || undefined);
      return;
    }

    let file: File;
    if (capturedBlob instanceof File) {
      // Gallery pick — already a proper File
      file = capturedBlob;
    } else {
      // Camera or voice capture — wrap blob
      const isPhoto = capturedBlob.type.startsWith("image");
      const isVoice = capturedBlob.type.startsWith("audio");
      const ext = isPhoto
        ? "jpg"
        : isVoice
          ? (MIME_TO_EXT[capturedBlob.type] ?? "webm")
          : (getSupportedMimeType()?.extension ?? "webm");
      const mimeType = isPhoto ? "image/jpeg" : (capturedBlob.type || "video/webm");
      const name = isVoice ? "voice" : "capture";
      file = new File([capturedBlob], `${name}-${Date.now()}.${ext}`, { type: mimeType });
    }

    handOver(file, notes.trim() || undefined);
  }, [capturedBlob, picked, prepareVideo, handOver, notes]);

  // --- Close handler ---
  const handleClose = useCallback(() => {
    stopCamera();
    cancelVoice();
    prepareRef.current?.abort();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    onClose();
  }, [stopCamera, cancelVoice, onClose]);

  // --- Flip ---
  // --- Framing ---
  const toggleFraming = useCallback(() => {
    setFraming((f) => {
      const next = f === "fit" ? "fill" : "fit";
      try {
        localStorage.setItem(FRAMING_KEY, next);
      } catch {
        // Not remembered; it still applies now.
      }
      return next;
    });
  }, []);

  const readFrameAspect = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const { videoWidth, videoHeight } = e.currentTarget;
      if (videoWidth > 0 && videoHeight > 0) {
        setFrameAspect(videoWidth / videoHeight);
      }
    },
    [],
  );

  const handleFlip = useCallback(() => {
    if (stage === "review" || mode === "voice") return;

    // Mid-take the recorder is fed by the canvas, not the camera, so only the
    // video source is swapped and the audio track it is recording keeps
    // running. Where the canvas could not be set up the recorder is bound
    // straight to the camera track and a flip would cut the take short, so it
    // is not offered.
    const midTake = stage === "recording";
    if (midTake && !canFlipMidTakeRef.current) return;

    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(10);
    }
    void switchCamera({ keepAudio: midTake });
  }, [stage, mode, switchCamera]);

  // --- Voice shutter: tap to start, then tap to pause or resume ---
  const handleVoiceShutter = useCallback(() => {
    if (voiceStatus === "idle") void startVoice();
    else if (voiceStatus === "recording") pauseVoice();
    else resumeVoice();
  }, [voiceStatus, startVoice, pauseVoice, resumeVoice]);

  /** One along the mode strip: a swipe left brings the next one over. */
  const stepMode = (by: 1 | -1) => {
    const next = modes[modes.findIndex((m) => m.id === mode) + by];
    if (next) switchMode(next.id);
  };

  // --- Viewfinder gestures ---
  const { handlers: gestureHandlers, isPinching } = useCameraGestures({
    // Off mid voice take: nothing on that screen answers a gesture, and a
    // stray swipe must not close it.
    enabled: stage !== "review" && (mode !== "voice" || voiceStatus === "idle"),
    onDoubleTap: handleFlip,
    onPinchStart: () => {
      pinchStartZoomRef.current = zoomRef.current;
    },
    onPinch: (scale) => {
      if (mode !== "voice") setZoom(pinchStartZoomRef.current * scale);
    },
    // Flicking the viewfinder away closes it, and flicking it sideways
    // changes mode, but neither out from under a take in progress.
    onSwipeDown: stage === "viewfinder" ? handleClose : undefined,
    onSwipeLeft: stage === "viewfinder" ? () => stepMode(1) : undefined,
    onSwipeRight: stage === "viewfinder" ? () => stepMode(-1) : undefined,
  });

  // --- Derived ---
  const isPhotoCapture = capturedBlob?.type.startsWith("image");
  const isVoiceCapture = capturedBlob?.type.startsWith("audio");
  const isVoice = mode === "voice";
  // What the screen shows. A voice take never leaves "viewfinder" until it is
  // finished, so whether one is running comes from the recorder.
  const view: CaptureStage =
    stage === "review"
      ? "review"
      : isVoice
        ? (voice.status === "idle" ? "viewfinder" : "recording")
        : stage;
  const paused = isVoice ? voice.status === "paused" : isPaused;
  const elapsed = isVoice ? voice.elapsed : recordingTime;
  const maxDuration = isVoice ? maxVoiceDuration : maxVideoDuration;
  const zoomFactor = zoom / zoomRange.min;
  const isZoomed = zoomFactor > 1.05;

  // --- Permission denied / unsupported ---
  // Only in camera mode: a voice note needs no camera, so it is offered here.
  // Not over a take under review either, which needs no camera: a file picked
  // where there is none is reviewed here too.
  if (
    stage !== "review" &&
    !isVoice &&
    (state === "denied" || state === "unsupported" || errorMessage)
  ) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-6">
        <div className="text-center space-y-3">
          <p className="text-white text-lg font-display">
            {state === "denied" ? "Camera Access Denied" : "Camera Unavailable"}
          </p>
          <p className="text-white/60 text-sm max-w-xs">
            {errorMessage ?? "Your browser or device does not support camera access."}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleClose} className="text-white border-white/20">
            Cancel
          </Button>
          <Button onClick={onFallback}>
            Use File Picker Instead
          </Button>
        </div>
        {allowVoice && (
          <button
            type="button"
            onClick={() => setMode("voice")}
            className="flex items-center gap-2 text-white/70 text-sm underline-offset-4 hover:underline"
          >
            <Mic className="w-4 h-4" aria-hidden />
            Record a voice note instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black motive-press-hold">
      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4">
        {/* On a review, ✕ discards the take and goes back to the camera, the
            way Snapchat does; only ✕ on the live camera leaves altogether. */}
        <button
          type="button"
          onClick={stage === "review" ? handleRetake : handleClose}
          className="p-2 rounded-full bg-black/40 backdrop-blur-sm"
          aria-label={
            stage === "review" ? "Discard and retake" : isVoice ? "Close" : "Close camera"
          }
        >
          <X className="w-5 h-5 text-white" />
        </button>

        {stage !== "review" && !isVoice && (
          <div className="flex items-center gap-2">
            {/* Not mid-take: the recording's shape is fixed when it starts. */}
            {stage === "viewfinder" && framingChoice && (
              <button
                type="button"
                onClick={toggleFraming}
                className="p-2 rounded-full bg-black/40 backdrop-blur-sm"
                aria-label={
                  framing === "fit" ? "Fill the screen" : "Show the whole frame"
                }
                aria-pressed={framing === "fill"}
              >
                {framing === "fit" ? (
                  <Maximize2 className="w-5 h-5 text-white" />
                ) : (
                  <Minimize2 className="w-5 h-5 text-white" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={handleFlip}
              className="p-2 rounded-full bg-black/40 backdrop-blur-sm"
              aria-label="Switch camera"
            >
              <RotateCcw className="w-5 h-5 text-white" />
            </button>
          </div>
        )}
      </div>

      {/* Recording indicator */}
      {view === "recording" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm">
          <motion.div
            className={cn("w-2.5 h-2.5 rounded-full", paused ? "bg-white/50" : "bg-red-500")}
            animate={paused ? { opacity: 1 } : { opacity: [1, 0.3, 1] }}
            transition={paused ? { duration: 0 } : { duration: 1, repeat: Infinity }}
          />
          <span className="text-white text-sm font-mono tabular-nums">
            {formatTime(elapsed)}
          </span>
          {paused && (
            <span className="text-white/50 text-xs uppercase tracking-wide">Paused</span>
          )}
        </div>
      )}

      {/* Center: viewfinder or preview — also the gesture surface */}
      <div
        className="relative flex-1 flex items-center justify-center overflow-hidden"
        style={{
          touchAction: stage === "review" ? undefined : "none",
          // Lets the "fit" viewfinder size itself against this box (cq units).
          containerType: "size",
        }}
        {...gestureHandlers}
      >
        {stage === "review" && previewUrl ? (
          isVoiceCapture ? (
            <div className="flex w-full justify-center px-6">
              <VoicePlayback src={previewUrl} />
            </div>
          ) : isPhotoCapture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Captured photo"
              className="w-full h-full object-contain"
            />
          ) : (
            <video
              ref={reviewVideoRef}
              src={previewUrl}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={picked ? readPreviewDuration : undefined}
              onTimeUpdate={keepToTrim}
              onEnded={loopTrim}
              className="w-full h-full object-contain"
            />
          )
        ) : isVoice ? (
          <div className="flex flex-col items-center gap-6 px-6 text-center">
            {voice.error ? (
              <>
                <p className="text-white text-lg font-display">
                  {voice.error === "denied"
                    ? "Microphone Access Denied"
                    : "Recording Unavailable"}
                </p>
                <p className="text-white/60 text-sm max-w-xs">
                  {voice.error === "denied"
                    ? "Please allow microphone access in your browser settings and try again."
                    : "Your browser does not support audio recording."}
                </p>
              </>
            ) : (
              <>
                <div
                  className={cn(
                    "w-24 h-24 rounded-full flex items-center justify-center transition-colors",
                    view === "recording" ? "bg-red-500/20" : "bg-white/10",
                  )}
                >
                  <Mic
                    className={cn(
                      "w-10 h-10",
                      view === "recording" && !paused ? "text-red-500" : "text-white/60",
                    )}
                  />
                </div>
                {/* The shutter's ring already shows how much of the take is
                    left, so a running take needs only the meter. */}
                {view === "recording" ? (
                  <VoiceMeter
                    analyserRef={voice.analyserRef}
                    active={voice.status === "recording"}
                  />
                ) : (
                  <p className="text-white/45 text-sm">Tap the button to record</p>
                )}
              </>
            )}
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={readFrameAspect}
            onResize={readFrameAspect}
            className={cn(
              "object-cover",
              framing === "fill" || !frameAspect
                ? "w-full h-full"
                : "rounded-2xl",
              !stream && "opacity-0",
            )}
            style={{
              // "fit": the element takes the camera's own shape, as large as
              // the box allows, so the cover trim — and the capture's — is
              // nothing. It must be the element that has the frame's shape,
              // not object-fit: contain, because the capture reads the
              // element's shape to know what is on screen.
              ...(framing === "fit" && frameAspect
                ? {
                    width: `min(100cqw, calc(100cqh * ${frameAspect}))`,
                    height: `min(100cqh, calc(100cqw / ${frameAspect}))`,
                  }
                : null),
              // The mirror and the digital zoom are one transform: scaling X
              // negatively flips the front camera, and the uniform scale is
              // the crop the capture pipeline reproduces.
              transform: `scaleX(${facingMode === "user" ? -1 : 1}) scale(${digitalZoom})`,
              transition: "transform 90ms linear",
            }}
          />
        )}

        {/* First-opens tip, over the bottom of the viewfinder */}
        {stage === "viewfinder" && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-4 z-10 whitespace-nowrap",
              "rounded-full bg-black/55 backdrop-blur-sm px-3.5 py-1.5 text-white/90 text-[13px]",
              "motion-safe:transition-opacity motion-safe:duration-500",
              showCoach ? "opacity-100" : "opacity-0",
            )}
          >
            Hold for video, double-tap to flip
          </div>
        )}

        {/* Why a video picked from the gallery can't be used, or why sending
            the take failed: in the tip's place, or on a review above the
            player's own controls */}
        {notice && (stage === "review" || (stage === "viewfinder" && !isVoice)) && (
          <div
            role="alert"
            className={cn(
              "pointer-events-none absolute left-1/2 -translate-x-1/2 z-10",
              stage === "review" ? "bottom-16" : "bottom-4",
              "w-max max-w-[calc(100%-2rem)] rounded-2xl bg-black/70 backdrop-blur-sm",
              "px-4 py-2.5 text-center text-white text-[13px] leading-snug",
            )}
          >
            {notice}
          </div>
        )}
      </div>

      {/* Zoom read-out */}
      {stage !== "review" && !isVoice && (isZoomed || isPinching) && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="absolute bottom-44 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/40 backdrop-blur-sm"
        >
          <span className="text-white text-sm font-mono tabular-nums">
            {zoomFactor.toFixed(1)}&times;
          </span>
        </motion.div>
      )}

      {/* The part of a long picked video to send */}
      {stage === "review" && trimDuration !== null && (
        <div className="shrink-0 px-4 pt-3 pb-3">
          <VideoTrimBar
            duration={trimDuration}
            length={maxVideoDuration}
            start={trimStart}
            onChange={moveTrim}
            onCommit={commitTrim}
          />
        </div>
      )}

      {/* Notes input on review */}
      {stage === "review" && (
        <div className="shrink-0 px-4">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a caption..."
            className="w-full rounded-lg bg-white/10 px-4 py-2.5 text-base text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-brand-ink"
          />
        </div>
      )}

      {/* Hidden file input for gallery */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleGalleryPick}
      />

      {/* Bottom controls */}
      <div className="shrink-0 pb-safe">
        <div className="flex flex-col items-center justify-center px-6 pt-2 pb-5">
          {(view === "viewfinder" || view === "recording") && (
            <>
              <ModeStrip
                modes={modes}
                mode={mode}
                hidden={view === "recording"}
                onChange={switchMode}
              />
              <div className="mt-2 flex items-center justify-center w-full max-w-xs">
                {/* Gallery button — hidden during recording */}
                <div className="flex-1 flex justify-center">
                  {view === "viewfinder" && !isVoice && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center"
                      aria-label="Pick from gallery"
                    >
                      <ImageIcon className="w-5 h-5 text-white" />
                    </button>
                  )}
                </div>

                {/* Capture button */}
                <div
                  className="relative shrink-0"
                  style={{ width: 80, height: 80, touchAction: "none" }}
                >
                  {/* Progress ring for recording */}
                  {view === "recording" && (
                    <svg
                      className="absolute inset-0 -rotate-90"
                      width="80"
                      height="80"
                      viewBox="0 0 80 80"
                    >
                      <circle
                        cx="40"
                        cy="40"
                        r={RING_RADIUS}
                        fill="none"
                        stroke="rgba(255,255,255,0.2)"
                        strokeWidth="4"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r={RING_RADIUS}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={RING_CIRCUMFERENCE}
                        strokeDashoffset={
                          RING_CIRCUMFERENCE * (1 - elapsed / maxDuration)
                        }
                        className={cn(
                          "transition-[stroke-dashoffset] duration-1000 ease-linear",
                          paused && "opacity-50",
                        )}
                      />
                    </svg>
                  )}

                  <button
                    type="button"
                    // Voice has no hold and no zoom: the shutter is a plain
                    // tap, to start a take and then to pause or resume it.
                    {...(isVoice
                      ? { onClick: handleVoiceShutter }
                      : {
                          onPointerDown: handlePointerDown,
                          onPointerMove: handleShutterMove,
                          onPointerUp: handlePointerUp,
                          onPointerCancel: handlePointerCancel,
                        })}
                    onContextMenu={(e) => e.preventDefault()}
                    draggable={false}
                    className={cn(
                      "absolute inset-0 rounded-full flex items-center justify-center transition-colors duration-150",
                      view === "viewfinder"
                        ? "border-4 border-white"
                        : "border-4 border-red-500",
                    )}
                    aria-label={
                      view === "viewfinder"
                        ? isVoice
                          ? "Start recording"
                          : mode === "video"
                            ? "Start video, slide up to zoom"
                            : "Tap for photo, hold for video, slide up to zoom"
                        : paused
                          ? "Resume recording"
                          : "Pause recording"
                    }
                  >
                    {view === "viewfinder" ? (
                      <div
                        className={cn(
                          "w-14 h-14 rounded-full transition-transform duration-100",
                          mode === "photo" ? "bg-white" : "bg-red-500",
                          isPressed && "scale-90",
                        )}
                      />
                    ) : paused ? (
                      // Paused: back to a record dot, because tapping resumes.
                      <motion.div
                        className="w-7 h-7 rounded-full bg-red-500"
                        initial={{ scale: 0.6 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.15 }}
                      />
                    ) : (
                      <motion.div
                        className="flex gap-1.5"
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.15 }}
                      >
                        <span className="block w-2 h-7 rounded-sm bg-red-500" />
                        <span className="block w-2 h-7 rounded-sm bg-red-500" />
                      </motion.div>
                    )}
                  </button>
                </div>

                {/* Finish button during a take — balances the gallery button */}
                <div className="flex-1 flex justify-center">
                  {view === "recording" && (
                    <motion.button
                      type="button"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.15 }}
                      onClick={isVoice ? voice.finish : finishRecording}
                      className="w-12 h-12 rounded-full bg-white flex items-center justify-center"
                      aria-label={isVoice ? "Finish recording" : "Finish video"}
                    >
                      <Check className="w-6 h-6 text-black" strokeWidth={3} />
                    </motion.button>
                  )}
                </div>
              </div>
            </>
          )}

          {stage === "review" && privacy && (
            <PrivateToggle
              tone="dark"
              isPrivate={privacy.isPrivate}
              onChange={privacy.onChange}
              className="mb-4"
            />
          )}
          {stage === "review" && (
            <div className="flex gap-4 w-full max-w-xs">
              <Button
                variant="secondary"
                className={cn(
                  "text-white border-white/20",
                  // A "Send to …" label needs the room more than Retake does.
                  useLabel ? "flex-none px-5" : "flex-1",
                )}
                onClick={handleRetake}
              >
                Retake
              </Button>
              {/* The button's own inner span sizes to its text; capped here so
                  a long group name truncates instead of running off the button. */}
              <Button className="flex-1 min-w-0 [&>span]:min-w-0 [&>span]:max-w-full" onClick={handleUse}>
                <span className="truncate">
                  {useLabel ??
                    (isVoiceCapture ? "Use Recording" : isPhotoCapture ? "Use Photo" : "Use Video")}
                </span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Preparing a picked video: it plays through once, out of sight, to be
          redrawn smaller, so it takes as long as the part being sent */}
      {preparing !== null && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/80 backdrop-blur-sm px-6 text-center">
          <p className="text-white text-base font-medium">Preparing video…</p>
          <div
            role="progressbar"
            aria-label="Preparing video"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(preparing * 100)}
            className="h-1 w-56 max-w-full overflow-hidden rounded-full bg-white/20"
          >
            <div
              className="h-full rounded-full bg-white motion-safe:transition-[width] motion-safe:duration-200 ease-linear"
              style={{ width: `${preparing * 100}%` }}
            />
          </div>
          <p className="text-white/50 text-xs">Keep the app open until it&rsquo;s done</p>
          <Button
            variant="secondary"
            className="mt-2 text-white border-white/20"
            onClick={cancelPreparing}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* The caller sending the take from here: the review waits underneath,
          to come back to if it fails */}
      {sending && (
        <div
          role="status"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm"
        >
          <Loader2 className="w-8 h-8 animate-spin text-white" aria-hidden />
          <p className="text-white text-base font-medium">Uploading…</p>
        </div>
      )}
    </div>
  );
}
