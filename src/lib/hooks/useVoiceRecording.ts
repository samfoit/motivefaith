"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getSupportedAudioMimeType } from "@/lib/utils/audio-recorder";
import { analyserLevel, newLevelMemory, type VoiceReadings } from "@/lib/utils/audio-level";

export type VoiceRecordingStatus = "idle" | "recording" | "paused";
export type VoiceRecordingError = "denied" | "unsupported";

export interface UseVoiceRecordingOptions {
  /** Seconds; the take finishes itself when it gets there. */
  maxDuration: number;
  /** The finished take, with a type the upload can map to an extension. */
  onFinish: (blob: Blob) => void;
}

export interface UseVoiceRecordingReturn {
  status: VoiceRecordingStatus;
  /** Recorded seconds; paused time does not count. */
  elapsed: number;
  error: VoiceRecordingError | null;
  /** The live mic's analyser while a take is open, for a level meter. */
  analyserRef: React.RefObject<AnalyserNode | null>;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  finish: () => void;
  /** Ends a take without keeping it. */
  cancel: () => void;
  /** The take's plumbing as it stands, for the on-screen readout (VoiceDebug). */
  inspect: () => VoiceReadings;
}

/**
 * A mic-only take for the capture flow's voice mode: start, pause, resume and
 * finish, the same shape as a video take. The mic is opened per take and let
 * go as soon as it ends, so nothing is listening between takes.
 */
export function useVoiceRecording({
  maxDuration,
  onFinish,
}: UseVoiceRecordingOptions): UseVoiceRecordingReturn {
  const [status, setStatus] = useState<VoiceRecordingStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<VoiceRecordingError | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** False when the take is being thrown away rather than finished. */
  const keepRef = useRef(true);
  /**
   * For the readout only: each state the meter's context has been in, how its
   * last wake went, why there is no context if making one failed, and the
   * loudest the mic has been this take.
   */
  const meterLogRef = useRef({
    states: [] as string[],
    resume: "not tried",
    error: "",
    level: newLevelMemory(),
  });

  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) audioCtxRef.current.onstatechange = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const finish = useCallback(() => {
    stopTimer();
    // Stopping flushes the last chunk and `onstop` hands the take over. This
    // is valid from a paused recorder too.
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, [stopTimer]);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= maxDuration) finish();
    }, 1000);
  }, [stopTimer, maxDuration, finish]);

  const start = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;

    const mimeInfo = getSupportedAudioMimeType();
    if (!mimeInfo) {
      setError("unsupported");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setError("denied");
      return;
    }
    streamRef.current = stream;
    setError(null);

    // The meter is a nicety: a browser without Web Audio still records.
    const meterLog = {
      states: [] as string[],
      resume: "not tried",
      error: "",
      level: newLevelMemory(),
    };
    meterLogRef.current = meterLog;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(analyser);
      // WebKit only runs the nodes something downstream pulls on, so an
      // analyser left dangling reads silence on iPhone. A muted gain carries
      // it to the speakers without playing the mic back.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      analyser.connect(mute).connect(ctx.destination);
      // Made after the mic prompt, the context is outside the tap and iOS
      // starts it suspended; a live mic lets it resume. A call or Siri can
      // suspend it again mid-take ("interrupted"), so it is woken then too.
      const wake = () => {
        if (meterLog.states.at(-1) !== ctx.state) meterLog.states.push(ctx.state);
        if (ctx.state !== "running" && ctx.state !== "closed") {
          meterLog.resume = "pending";
          void ctx.resume().then(
            () => {
              meterLog.resume = "resolved";
            },
            (err: unknown) => {
              meterLog.resume = `refused (${(err as { name?: string } | null)?.name ?? String(err)})`;
            },
          );
        }
      };
      ctx.onstatechange = wake;
      wake();
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch (err) {
      analyserRef.current = null;
      meterLog.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }

    chunksRef.current = [];
    keepRef.current = true;
    const recorder = new MediaRecorder(stream, { mimeType: mimeInfo.mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stopTimer();
      releaseMic();
      setStatus("idle");
      if (!keepRef.current) return;
      // The bare type, without ";codecs=…": it is what the upload maps to a
      // file extension and what the bucket's allowed types list.
      const type = mimeInfo.mimeType.split(";")[0];
      onFinishRef.current(new Blob(chunksRef.current, { type }));
    };

    recorder.start();
    elapsedRef.current = 0;
    setElapsed(0);
    setStatus("recording");
    startTimer();
  }, [startTimer, stopTimer, releaseMic]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    // Safari before 14.1 has no pause(); there a tap ends the take instead,
    // the same as a video take does.
    if (typeof recorder.pause !== "function") {
      finish();
      return;
    }

    recorder.pause();
    stopTimer();
    setStatus("paused");
  }, [finish, stopTimer]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;

    recorder.resume();
    setStatus("recording");
    startTimer();
  }, [startTimer]);

  const cancel = useCallback(() => {
    keepRef.current = false;
    stopTimer();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      releaseMic();
    }
    elapsedRef.current = 0;
    setElapsed(0);
    setStatus("idle");
  }, [stopTimer, releaseMic]);

  const inspect = useCallback((): VoiceReadings => {
    const recorder = recorderRef.current;
    const track = streamRef.current?.getAudioTracks()[0];
    const ctx = audioCtxRef.current;
    const log = meterLogRef.current;
    return {
      format: recorder?.mimeType || getSupportedAudioMimeType()?.mimeType || "none",
      recorder: recorder?.state ?? "none",
      mic: track
        ? `${track.readyState}${track.muted ? ", muted" : ""}${track.enabled ? "" : ", disabled"}`
        : "none",
      context: ctx ? `${ctx.state}, ${ctx.sampleRate} Hz` : log.error || "none",
      states: log.states.join(" > ") || "none",
      resume: log.resume,
      level: analyserLevel(analyserRef.current, log.level),
    };
  }, []);

  // --- Cleanup on unmount: never leave the mic open ---
  useEffect(() => {
    return () => {
      keepRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return { status, elapsed, error, analyserRef, start, pause, resume, finish, cancel, inspect };
}
