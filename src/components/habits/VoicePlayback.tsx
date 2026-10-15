"use client";

import { useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatClock } from "@/components/ui/AudioPlayer";
import { useAudioPlayback } from "@/lib/hooks/useAudioPlayback";
import { VoiceMeter } from "@/components/habits/VoiceMeter";

/**
 * The review of a voice take on the dark capture screens: a large play
 * button, the same level meter the take was recorded with, now following the
 * playback, and a seekable track with the time.
 *
 * Takes the place of the browser's `<audio controls>`, which cannot seek or
 * show a length for a MediaRecorder file in Chrome (its header has none) and
 * looks different in every browser.
 */
export function VoicePlayback({ src }: { src: string }) {
  const { audioRef, audioProps, playing, current, duration, toggle, seek } =
    useAudioPlayback();

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** An element can be routed through Web Audio only once. */
  const routedRef = useRef(false);

  // Routes the element through an analyser on the first play, which is a
  // user gesture, so the context starts running rather than suspended. The
  // meter is a nicety: if Web Audio is missing the element still plays on
  // its own.
  const routeThroughAnalyser = useCallback(() => {
    const el = audioRef.current;
    if (!el || routedRef.current) return;
    routedRef.current = true;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaElementSource(el).connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch {
      analyserRef.current = null;
    }
  }, [audioRef]);

  const handleToggle = useCallback(() => {
    if (audioRef.current?.paused) {
      routeThroughAnalyser();
      // Once routed, the sound only comes out of a running context.
      void audioCtxRef.current?.resume().catch(() => {});
    }
    toggle();
  }, [audioRef, routeThroughAnalyser, toggle]);

  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, []);

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-8">
      <audio src={src} {...audioProps} />

      <div className="relative">
        {playing && (
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-full bg-[var(--color-brand)]/30"
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <button
          type="button"
          onClick={handleToggle}
          aria-label={playing ? "Pause recording" : "Play recording"}
          className={cn(
            "relative flex h-24 w-24 items-center justify-center rounded-full text-on-brand",
            "bg-[var(--color-brand)] shadow-lg shadow-[var(--color-brand)]/30",
            "transition-transform active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
          )}
        >
          {playing ? (
            <Pause className="h-9 w-9" fill="currentColor" strokeWidth={0} />
          ) : (
            <Play className="ml-1 h-9 w-9" fill="currentColor" strokeWidth={0} />
          )}
        </button>
      </div>

      <VoiceMeter analyserRef={analyserRef} active={playing} tone="play" />

      <div className="w-full">
        {/* The visible track is drawn; a transparent range input over it does
            the seeking, so dragging, tapping and arrow keys all come free. */}
        <div className="relative h-6">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-[var(--color-brand)]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
            style={{ left: `${progress * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!duration}
            aria-label="Seek"
            aria-valuetext={`${formatClock(current)} of ${formatClock(duration)}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </div>
        <div className="mt-1 flex justify-between text-xs tabular-nums text-white/50">
          <span>{formatClock(current)}</span>
          <span>{duration > 0 ? formatClock(duration) : "–:––"}</span>
        </div>
      </div>
    </div>
  );
}
