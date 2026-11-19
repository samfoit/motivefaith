"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { X, Mic, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { VoicePlayback } from "@/components/habits/VoicePlayback";
import { VoiceHalo } from "@/components/habits/VoiceMeter";
import { VoiceWaveform, RECORD_RED } from "@/components/habits/VoiceWaveform";
import { PrivateToggle } from "@/components/habits/PrivateToggle";
import { useVoiceRecording } from "@/lib/hooks/useVoiceRecording";
import { getSupportedAudioMimeType } from "@/lib/utils/audio-recorder";
import { MIME_TO_EXT } from "@/lib/utils/media-types";
import { MAX_AUDIO_DURATION_S } from "@/lib/constants/limits";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A finished recording, its link for the player and the waveform it drew. */
interface Take {
  blob: Blob;
  url: string;
  wave: number[];
}

export interface VoiceRecorderProps {
  /**
   * Hands the recording on. A caller that sends it from the review itself, as
   * a habit's check-in does, returns a promise: the review stays up under
   * "Uploading…" until it settles, and a rejection's message is shown on it,
   * with the recording still there to send again or retake.
   */
  onCapture: (file: File) => void | Promise<void>;
  onClose: () => void;
  maxDuration?: number;
  /**
   * Offers the private switch on the review step, for a check-in whose
   * recording can be kept out of partners' view. Absent hides it.
   */
  privacy?: {
    isPrivate: boolean;
    onChange: (isPrivate: boolean) => void;
  };
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
  privacy,
}: VoiceRecorderProps) {
  const [take, setTake] = useState<Take | null>(null);
  /** No MediaRecorder here at all: known once the page is in the browser. */
  const [unsupported, setUnsupported] = useState(false);
  /** The caller is sending the recording from the review (see onCapture). */
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  /** Why the recording couldn't be sent. */
  const [sendError, setSendError] = useState<string | null>(null);

  // The mic, the recorder and the waveform are the capture screen's voice
  // mode's (useVoiceRecording), so the two record and look alike.
  const voice = useVoiceRecording({
    maxDuration,
    onFinish: (blob, wave) => setTake({ blob, wave, url: URL.createObjectURL(blob) }),
  });
  const { waveRef, cancel } = voice;
  const readWave = useCallback(() => waveRef.current, [waveRef]);

  const recording = voice.status !== "idle";
  const stage = take ? "review" : recording ? "recording" : "idle";

  // --- Detect audio support on mount ---
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- MediaRecorder support is only knowable in the browser, after hydration.
    if (!getSupportedAudioMimeType()) setUnsupported(true);
  }, []);

  // --- Let go of the review's link on unmount (the hook lets go of the mic) ---
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  }, [take]);
  useEffect(() => {
    return () => {
      if (takeRef.current) URL.revokeObjectURL(takeRef.current.url);
    };
  }, []);

  // --- Retake ---
  const handleRetake = useCallback(() => {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setSendError(null);
  }, [take]);

  // --- Use recording ---
  const handleUse = useCallback(() => {
    if (!take || sendingRef.current) return;
    const file = new File(
      [take.blob],
      `voice-${Date.now()}.${MIME_TO_EXT[take.blob.type] ?? "webm"}`,
      { type: take.blob.type },
    );
    const sent = onCapture(file);
    if (!sent) return;
    // Set before React draws the overlay, so a second tap already landing
    // on the button can't send the recording twice.
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    const settle = () => {
      sendingRef.current = false;
      setSending(false);
    };
    sent.then(settle, (err: unknown) => {
      settle();
      setSendError(err instanceof Error ? err.message : "Couldn't send. Try again.");
    });
  }, [take, onCapture]);

  // --- Close handler ---
  const handleClose = useCallback(() => {
    cancel();
    onClose();
  }, [cancel, onClose]);

  // --- Permission denied / unsupported ---
  const problem = unsupported ? "unsupported" : voice.error;
  if (problem) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-6">
        <div className="text-center space-y-3">
          <p className="text-white text-lg font-display">
            {problem === "denied" ? "Microphone Access Denied" : "Recording Unavailable"}
          </p>
          <p className="text-white/60 text-sm max-w-xs">
            {problem === "denied"
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

      {/* Center content. The mic, the waveform and the line under it sit
          where the review's play button, waveform and seek track do, so
          nothing moves from one step to the next. */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        {stage !== "review" && (
          <>
            <VoiceHalo analyserRef={voice.analyserRef} active={recording}>
              {/* White like the tape and the review's play button; the red of
                  a live mic is the stop button's and the playhead's */}
              <div className="w-24 h-24 rounded-full flex items-center justify-center bg-white/10">
                <Mic
                  className={cn(
                    "w-10 h-10 transition-colors",
                    recording ? "text-white" : "text-white/60",
                  )}
                />
              </div>
            </VoiceHalo>
            {/* The mic going in: bars arrive at the playhead as it is heard */}
            <VoiceWaveform read={readWave} tone={recording ? "record" : "idle"} moving />
            <div className="h-11 text-center">
              {recording ? (
                <>
                  <p className="text-white text-2xl leading-7 font-mono tabular-nums">
                    {formatTime(voice.elapsed)}
                  </p>
                  <p className="text-white/50 text-xs leading-4 tabular-nums">
                    {formatTime(Math.max(0, maxDuration - voice.elapsed))} remaining
                  </p>
                </>
              ) : (
                <p className="text-white/50 text-sm">Tap to start recording</p>
              )}
            </div>
          </>
        )}

        {/* Review state */}
        {take && (
          <>
            <VoicePlayback src={take.url} wave={take.wave} take={take.blob} />
            {sendError && (
              <p
                role="alert"
                className="mx-6 max-w-xs rounded-2xl bg-white/10 px-4 py-2.5 text-center text-white text-[13px] leading-snug"
              >
                {sendError}
              </p>
            )}
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
              onClick={voice.start}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center"
              aria-label="Start recording"
            >
              <div className="w-14 h-14 rounded-full" style={{ backgroundColor: RECORD_RED }} />
            </button>
          )}

          {/* Recording — stop button */}
          {stage === "recording" && (
            <button
              type="button"
              onClick={voice.finish}
              className="w-20 h-20 rounded-full border-4 flex items-center justify-center"
              style={{ borderColor: RECORD_RED }}
              aria-label="Stop recording"
            >
              <motion.div
                className="w-7 h-7 rounded-sm"
                style={{ backgroundColor: RECORD_RED }}
                initial={{ scale: 0, borderRadius: "50%" }}
                animate={{ scale: 1, borderRadius: "4px" }}
                transition={{ duration: 0.15 }}
              />
            </button>
          )}

          {/* Review — retake / use */}
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

      {/* The caller sending the recording from here: the review waits
          underneath, to come back to if it fails */}
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
