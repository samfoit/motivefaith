"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { X, RotateCcw, Image as ImageIcon, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { useCamera } from "@/lib/hooks/useCamera";
import { useCameraGestures } from "@/lib/hooks/useCameraGestures";
import { getSupportedMimeType } from "@/lib/utils/media-recorder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CaptureStage = "viewfinder" | "recording" | "review";

export interface CameraCaptureProps {
  onCapture: (file: File, notes?: string) => void;
  onClose: () => void;
  onFallback: () => void;
  maxVideoDuration?: number;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CameraCapture({
  onCapture,
  onClose,
  onFallback,
  maxVideoDuration = 15,
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

  const [stage, setStage] = useState<CaptureStage>("viewfinder");
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [notes, setNotes] = useState("");
  const [isPressed, setIsPressed] = useState(false);
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
  useEffect(() => {
    requestCamera();
  }, [requestCamera]);

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

    // Take only the part of the frame the viewfinder is showing. A digital
    // zoom is a crop, so the photo comes out at the cropped size rather than
    // being stretched back up to the sensor's.
    const z = digitalZoomRef.current;
    const sw = video.videoWidth / z;
    const sh = video.videoHeight / z;
    const sx = (video.videoWidth - sw) / 2;
    const sy = (video.videoHeight - sh) / 2;

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
        // Fixed for the whole take — a canvas that resized mid-recording would
        // corrupt the file. Anything the camera sends is fitted to these
        // dimensions below, including the other camera's, which need not have
        // the same resolution or even the same aspect ratio.
        mc.width = video.videoWidth || 640;
        mc.height = video.videoHeight || 480;
        const frameAspect = mc.width / mc.height;

        const drawFrame = () => {
          const z = digitalZoomRef.current;
          const vw = video.videoWidth || mc.width;
          const vh = video.videoHeight || mc.height;

          // Cover-crop to the frame's shape, then crop again for the zoom, so
          // the picture fills the frame without ever being stretched.
          let sw = vw;
          let sh = vh;
          if (vw / vh > frameAspect) sw = vh * frameAspect;
          else sh = vw / frameAspect;
          sw /= z;
          sh /= z;

          ctx.save();
          if (mirrorRef.current) {
            ctx.translate(mc.width, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(
            video,
            (vw - sw) / 2,
            (vh - sh) / 2,
            sw,
            sh,
            0,
            0,
            mc.width,
            mc.height,
          );
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

    // Only the viewfinder arms the hold: once a take is open, a press on the
    // shutter is a tap to pause or resume, not another hold.
    if (stage !== "viewfinder") return;

    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (isHoldingRef.current) {
        startedTakeRef.current = true;
        startRecording();
      }
    }, HOLD_THRESHOLD_MS);
  }, [stage, startRecording]);

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

    // Letting go no longer ends a take. The hand comes off the shutter and the
    // viewfinder gestures are free again; a later tap is what pauses it.
    if (stage !== "recording" || dragged || startedTake) return;

    if (isPaused) resumeRecording();
    else pauseRecording();
  }, [stage, capturePhoto, isPaused, pauseRecording, resumeRecording]);

  const handlePointerCancel = useCallback(() => {
    setIsPressed(false);
    shutterDragRef.current = null;
    startedTakeRef.current = false;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    isHoldingRef.current = false;
  }, []);

  // --- Gallery pick ---
  const handleGalleryPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCapturedBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
    setStage("review");
    stopCamera();

    // Reset input so the same file can be re-selected
    e.target.value = "";
  }, [stopCamera]);

  // --- Retake ---
  const handleRetake = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    setRecordingTime(0);
    setIsPaused(false);
    setNotes("");
    setStage("viewfinder");
    requestCamera();
  }, [previewUrl, requestCamera]);

  // --- Use capture ---
  const handleUse = useCallback(() => {
    if (!capturedBlob) return;

    let file: File;
    if (capturedBlob instanceof File) {
      // Gallery pick — already a proper File
      file = capturedBlob;
    } else {
      // Camera capture — wrap blob
      const isPhoto = capturedBlob.type.startsWith("image");
      const ext = isPhoto ? "jpg" : (getSupportedMimeType()?.extension ?? "webm");
      const mimeType = isPhoto ? "image/jpeg" : (capturedBlob.type || "video/webm");
      file = new File([capturedBlob], `capture-${Date.now()}.${ext}`, { type: mimeType });
    }

    stopCamera();
    onCapture(file, notes.trim() || undefined);
  }, [capturedBlob, stopCamera, onCapture, notes]);

  // --- Close handler ---
  const handleClose = useCallback(() => {
    stopCamera();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    onClose();
  }, [stopCamera, onClose]);

  // --- Flip ---
  const handleFlip = useCallback(() => {
    if (stage === "review") return;

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
  }, [stage, switchCamera]);

  // --- Viewfinder gestures ---
  const { handlers: gestureHandlers, isPinching } = useCameraGestures({
    enabled: stage !== "review",
    onDoubleTap: handleFlip,
    onPinchStart: () => {
      pinchStartZoomRef.current = zoomRef.current;
    },
    onPinch: (scale) => setZoom(pinchStartZoomRef.current * scale),
    // Flicking the viewfinder away closes it, but not out from under a take
    // in progress.
    onSwipeDown: stage === "viewfinder" ? handleClose : undefined,
  });

  // --- Derived ---
  const isPhotoCapture = capturedBlob?.type.startsWith("image");
  const zoomFactor = zoom / zoomRange.min;
  const isZoomed = zoomFactor > 1.05;

  // --- Permission denied / unsupported ---
  if (state === "denied" || state === "unsupported" || errorMessage) {
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
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black motive-press-hold">
      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4">
        <button
          type="button"
          onClick={handleClose}
          className="p-2 rounded-full bg-black/40 backdrop-blur-sm"
          aria-label="Close camera"
        >
          <X className="w-5 h-5 text-white" />
        </button>

        {stage !== "review" && (
          <button
            type="button"
            onClick={handleFlip}
            className="p-2 rounded-full bg-black/40 backdrop-blur-sm"
            aria-label="Switch camera"
          >
            <RotateCcw className="w-5 h-5 text-white" />
          </button>
        )}
      </div>

      {/* Recording indicator */}
      {stage === "recording" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm">
          <motion.div
            className={cn("w-2.5 h-2.5 rounded-full", isPaused ? "bg-white/50" : "bg-red-500")}
            animate={isPaused ? { opacity: 1 } : { opacity: [1, 0.3, 1] }}
            transition={isPaused ? { duration: 0 } : { duration: 1, repeat: Infinity }}
          />
          <span className="text-white text-sm font-mono tabular-nums">
            {formatTime(recordingTime)}
          </span>
          {isPaused && (
            <span className="text-white/50 text-xs uppercase tracking-wide">Paused</span>
          )}
        </div>
      )}

      {/* Center: viewfinder or preview — also the gesture surface */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden"
        style={{ touchAction: stage === "review" ? undefined : "none" }}
        {...gestureHandlers}
      >
        {stage === "review" && previewUrl ? (
          isPhotoCapture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Captured photo"
              className="w-full h-full object-contain"
            />
          ) : (
            <video
              src={previewUrl}
              controls
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn("w-full h-full object-cover", !stream && "opacity-0")}
            style={{
              // The mirror and the digital zoom are one transform: scaling X
              // negatively flips the front camera, and the uniform scale is
              // the crop the capture pipeline reproduces.
              transform: `scaleX(${facingMode === "user" ? -1 : 1}) scale(${digitalZoom})`,
              transition: "transform 90ms linear",
            }}
          />
        )}
      </div>

      {/* Zoom read-out */}
      {stage !== "review" && (isZoomed || isPinching) && (
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

      {/* Notes input on review */}
      {stage === "review" && (
        <div className="shrink-0 px-4">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a caption..."
            className="w-full rounded-lg bg-white/10 px-4 py-2.5 text-base text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-brand"
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
        <div className="flex flex-col items-center justify-center p-6">
          {(stage === "viewfinder" || stage === "recording") && (
            <>
              <div className="flex items-center justify-center w-full max-w-xs">
                {/* Gallery button — hidden during recording */}
                <div className="flex-1 flex justify-center">
                  {stage === "viewfinder" && (
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
                  {stage === "recording" && (
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
                          RING_CIRCUMFERENCE * (1 - recordingTime / maxVideoDuration)
                        }
                        className={cn(
                          "transition-[stroke-dashoffset] duration-1000 ease-linear",
                          isPaused && "opacity-50",
                        )}
                      />
                    </svg>
                  )}

                  <button
                    type="button"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handleShutterMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                    onContextMenu={(e) => e.preventDefault()}
                    draggable={false}
                    className={cn(
                      "absolute inset-0 rounded-full flex items-center justify-center transition-colors duration-150",
                      stage === "viewfinder"
                        ? "border-4 border-white"
                        : "border-4 border-red-500",
                    )}
                    aria-label={
                      stage === "viewfinder"
                        ? "Tap for photo, hold for video, slide up to zoom"
                        : isPaused
                          ? "Resume recording"
                          : "Pause recording"
                    }
                  >
                    {stage === "viewfinder" ? (
                      <div
                        className={cn(
                          "w-14 h-14 rounded-full bg-white transition-transform duration-100",
                          isPressed && "scale-90",
                        )}
                      />
                    ) : isPaused ? (
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
                  {stage === "recording" && (
                    <motion.button
                      type="button"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.15 }}
                      onClick={finishRecording}
                      className="w-12 h-12 rounded-full bg-white flex items-center justify-center"
                      aria-label="Finish video"
                    >
                      <Check className="w-6 h-6 text-black" strokeWidth={3} />
                    </motion.button>
                  )}
                </div>
              </div>

              <div className="mt-3 text-center select-none">
                {stage === "viewfinder" ? (
                  <>
                    <p className="text-white/40 text-xs">
                      Tap for photo &middot; Hold for video
                    </p>
                    <p className="text-white/25 text-[11px] mt-0.5">
                      Double-tap to flip &middot; Pinch or slide up to zoom
                    </p>
                  </>
                ) : (
                  <p className="text-white/40 text-xs">
                    {isPaused ? "Tap to keep going" : "Tap to pause"} &middot; Check to finish
                  </p>
                )}
              </div>
            </>
          )}

          {stage === "review" && (
            <div className="flex gap-4 w-full max-w-xs">
              <Button
                variant="secondary"
                className="flex-1 text-white border-white/20"
                onClick={handleRetake}
              >
                Retake
              </Button>
              <Button className="flex-1" onClick={handleUse}>
                {isPhotoCapture ? "Use Photo" : "Use Video"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
