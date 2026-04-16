"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { X, Mic } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getSupportedAudioMimeType } from "@/lib/utils/audio-recorder";
import { MAX_AUDIO_DURATION_S } from "@/lib/constants/limits";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecordingStage = "idle" | "recording" | "review";

export interface VoiceRecorderProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  maxDuration?: number;
}

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

export function VoiceRecorder({
  onCapture,
  onClose,
  maxDuration = MAX_AUDIO_DURATION_S,
}: VoiceRecorderProps) {
  const [stage, setStage] = useState<RecordingStage>("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<
    "prompt" | "granted" | "denied" | "unsupported"
  >("prompt");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeInfoRef = useRef<{ mimeType: string; extension: string } | null>(null);

  // --- Detect audio support on mount ---
  useEffect(() => {
    const info = getSupportedAudioMimeType();
    if (!info) {
      setPermissionState("unsupported");
      return;
    }
    mimeInfoRef.current = info;
  }, []);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // Only run cleanup on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Request mic and start recording ---
  const startRecording = useCallback(async () => {
    const mimeInfo = mimeInfoRef.current;
    if (!mimeInfo) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;
      setPermissionState("granted");

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: mimeInfo.mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeInfo.mimeType });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setPreviewUrl(url);
        setStage("review");

        // Stop the mic stream
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      recorder.start();
      setStage("recording");
      setRecordingTime(0);

      let elapsed = 0;
      timerRef.current = setInterval(() => {
        elapsed += 1;
        setRecordingTime(elapsed);
        if (elapsed >= maxDuration) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (recorderRef.current?.state === "recording") {
            recorderRef.current.stop();
          }
        }
      }, 1000);
    } catch {
      setPermissionState("denied");
    }
  }, [maxDuration]);

  // --- Stop recording ---
  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // --- Retake ---
  const handleRetake = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setAudioBlob(null);
    setRecordingTime(0);
    setStage("idle");
  }, [previewUrl]);

  // --- Use recording ---
  const handleUse = useCallback(() => {
    if (!audioBlob || !mimeInfoRef.current) return;
    const file = new File(
      [audioBlob],
      `voice-${Date.now()}.${mimeInfoRef.current.extension}`,
      { type: mimeInfoRef.current.mimeType },
    );
    onCapture(file);
  }, [audioBlob, onCapture]);

  // --- Close handler ---
  const handleClose = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onClose();
  }, [onClose]);

  // --- Permission denied / unsupported ---
  if (permissionState === "denied" || permissionState === "unsupported") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-6">
        <div className="text-center space-y-3">
          <p className="text-white text-lg font-display">
            {permissionState === "denied"
              ? "Microphone Access Denied"
              : "Recording Unavailable"}
          </p>
          <p className="text-white/60 text-sm max-w-xs">
            {permissionState === "denied"
              ? "Please allow microphone access in your browser settings and try again."
              : "Your browser does not support audio recording."}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={handleClose}
          className="text-white border-white/20"
        >
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4">
        <button
          type="button"
          onClick={handleClose}
          className="p-2 rounded-full bg-white/10 backdrop-blur-sm"
          aria-label="Close recorder"
        >
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        {/* Idle state */}
        {stage === "idle" && (
          <>
            <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center">
              <Mic className="w-10 h-10 text-white/60" />
            </div>
            <p className="text-white/40 text-sm">Tap to start recording</p>
          </>
        )}

        {/* Recording state */}
        {stage === "recording" && (
          <>
            <div className="relative">
              {/* Pulsing ring */}
              <motion.div
                className="absolute inset-0 rounded-full bg-red-500/20"
                animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                style={{ width: 96, height: 96 }}
              />
              <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center relative z-10">
                <motion.div
                  className="w-3 h-3 rounded-full bg-red-500"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </div>
            </div>
            <span className="text-white text-2xl font-mono tabular-nums">
              {formatTime(recordingTime)}
            </span>
            <p className="text-white/40 text-xs">
              {formatTime(maxDuration - recordingTime)} remaining
            </p>
          </>
        )}

        {/* Review state */}
        {stage === "review" && previewUrl && (
          <>
            <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center">
              <Mic className="w-10 h-10 text-white/60" />
            </div>
            <span className="text-white/60 text-sm font-mono tabular-nums">
              {formatTime(recordingTime)}
            </span>
            <audio
              src={previewUrl}
              controls
              preload="metadata"
              className="w-full max-w-xs"
            />
          </>
        )}
      </div>

      {/* Bottom controls */}
      <div className="shrink-0 pb-safe">
        <div className="flex flex-col items-center justify-center p-6">
          {/* Idle — record button */}
          {stage === "idle" && (
            <button
              type="button"
              onClick={startRecording}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center"
              aria-label="Start recording"
            >
              <div className="w-14 h-14 rounded-full bg-red-500" />
            </button>
          )}

          {/* Recording — stop button */}
          {stage === "recording" && (
            <button
              type="button"
              onClick={stopRecording}
              className="w-20 h-20 rounded-full border-4 border-red-500 flex items-center justify-center"
              aria-label="Stop recording"
            >
              <motion.div
                className="w-7 h-7 rounded-sm bg-red-500"
                initial={{ scale: 0, borderRadius: "50%" }}
                animate={{ scale: 1, borderRadius: "4px" }}
                transition={{ duration: 0.15 }}
              />
            </button>
          )}

          {/* Review — retake / use */}
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
                Use Recording
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
