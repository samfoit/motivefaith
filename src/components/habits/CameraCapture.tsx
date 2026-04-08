"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { X, RotateCcw, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { useCamera } from "@/lib/hooks/useCamera";
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
  const { state, stream, facingMode, errorMessage, requestCamera, switchCamera, stopCamera } =
    useCamera({ audio: true });

  const [stage, setStage] = useState<CaptureStage>("viewfinder");
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
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
      if (recorderRef.current && recorderRef.current.state === "recording") {
        recorderRef.current.stop();
      }
    };
  }, [stopCamera]);

  // --- Photo capture ---
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror the captured photo when using front camera
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

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

  // --- Stop mirror canvas animation loop ---
  const stopMirrorLoop = useCallback(() => {
    if (mirrorAnimRef.current != null) {
      cancelAnimationFrame(mirrorAnimRef.current);
      mirrorAnimRef.current = null;
    }
  }, []);

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

    // When using front camera, mirror the video stream via an offscreen canvas
    // so the saved file matches what the user sees (Snapchat-style).
    let recordStream = stream;
    if (facingMode === "user") {
      const video = videoRef.current;
      if (video) {
        const mc = document.createElement("canvas");
        mc.width = video.videoWidth || 640;
        mc.height = video.videoHeight || 480;
        const ctx = mc.getContext("2d");
        if (ctx) {
          const drawFrame = () => {
            if (mc.width !== video.videoWidth) mc.width = video.videoWidth;
            if (mc.height !== video.videoHeight) mc.height = video.videoHeight;
            ctx.save();
            ctx.translate(mc.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0);
            ctx.restore();
            mirrorAnimRef.current = requestAnimationFrame(drawFrame);
          };
          mirrorAnimRef.current = requestAnimationFrame(drawFrame);

          const mirroredStream = mc.captureStream(30);
          // Combine mirrored video track with original audio tracks
          const combined = new MediaStream();
          mirroredStream.getVideoTracks().forEach((t) => combined.addTrack(t));
          stream.getAudioTracks().forEach((t) => combined.addTrack(t));
          recordStream = combined;
        }
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
    setRecordingTime(0);


    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed += 1;
      setRecordingTime(elapsed);
      if (elapsed >= maxVideoDuration) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
        stopCamera();
      }
    }, 1000);
  }, [stream, maxVideoDuration, capturePhoto, stopCamera, facingMode, stopMirrorLoop]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMirrorLoop();
    stopCamera();
  }, [stopCamera, stopMirrorLoop]);

  // --- Global pointer up listener during recording ---
  useEffect(() => {
    if (stage !== "recording") return;

    const handleGlobalUp = () => {
      stopRecording();
      setIsPressed(false);
      isHoldingRef.current = false;
    };

    window.addEventListener("pointerup", handleGlobalUp);
    window.addEventListener("pointercancel", handleGlobalUp);

    return () => {
      window.removeEventListener("pointerup", handleGlobalUp);
      window.removeEventListener("pointercancel", handleGlobalUp);
    };
  }, [stage, stopRecording]);

  // --- Snapchat-style tap/hold handlers ---
  const handlePointerDown = useCallback(() => {
    if (stage !== "viewfinder") return;
    isHoldingRef.current = true;
    setIsPressed(true);

    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (isHoldingRef.current) {
        startRecording();
      }
    }, HOLD_THRESHOLD_MS);
  }, [stage, startRecording]);

  const handlePointerUp = useCallback(() => {
    setIsPressed(false);

    if (holdTimerRef.current) {
      // Released before hold threshold — take photo
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (isHoldingRef.current && stage === "viewfinder") {
        capturePhoto();
      }
    }
    // If recording, the global listener handles stopRecording
    isHoldingRef.current = false;
  }, [stage, capturePhoto]);

  const handlePointerCancel = useCallback(() => {
    setIsPressed(false);
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
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    onClose();
  }, [stopCamera, onClose]);

  // --- Derived ---
  const isPhotoCapture = capturedBlob?.type.startsWith("image");

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
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
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
            onClick={switchCamera}
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
            className="w-2.5 h-2.5 rounded-full bg-red-500"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
          <span className="text-white text-sm font-mono tabular-nums">
            {formatTime(recordingTime)}
          </span>
        </div>
      )}

      {/* Center: viewfinder or preview */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
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
            className={cn(
              "w-full h-full object-cover",
              !stream && "opacity-0",
              facingMode === "user" && "-scale-x-100",
            )}
          />
        )}
      </div>

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
                        className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                      />
                    </svg>
                  )}

                  <button
                    type="button"
                    onPointerDown={handlePointerDown}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={stage === "viewfinder" ? handlePointerCancel : undefined}
                    onPointerCancel={handlePointerCancel}
                    className={cn(
                      "absolute inset-0 rounded-full flex items-center justify-center transition-colors duration-150",
                      stage === "viewfinder"
                        ? "border-4 border-white"
                        : "border-4 border-red-500",
                    )}
                    aria-label="Tap for photo, hold for video"
                  >
                    {stage === "viewfinder" ? (
                      <div
                        className={cn(
                          "w-14 h-14 rounded-full bg-white transition-transform duration-100",
                          isPressed && "scale-90",
                        )}
                      />
                    ) : (
                      <motion.div
                        className="w-7 h-7 rounded-sm bg-red-500"
                        initial={{ scale: 0, borderRadius: "50%" }}
                        animate={{ scale: 1, borderRadius: "4px" }}
                        transition={{ duration: 0.15 }}
                      />
                    )}
                  </button>
                </div>

                {/* Spacer to balance gallery button */}
                <div className="flex-1" />
              </div>

              {stage === "viewfinder" && (
                <p className="text-white/40 text-xs mt-3 select-none">
                  Tap for photo &middot; Hold for video
                </p>
              )}
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
