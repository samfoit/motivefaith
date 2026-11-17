"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatClock } from "@/components/ui/AudioPlayer";
import { useAudioPlayback } from "@/lib/hooks/useAudioPlayback";
import { VoiceWaveform, type WaveFrame } from "@/components/habits/VoiceWaveform";
import { VoiceDebug } from "@/components/habits/VoiceDebug";
import type { VoiceReadings } from "@/lib/utils/audio-level";
import { WAVE_BAR_SECONDS, decodeTakeWave, isFlatWave } from "@/lib/utils/voice-wave";

const NO_BARS: readonly number[] = [];

/**
 * The review of a voice take on the dark capture screens: a large play
 * button, the waveform the take drew while it was recorded, now running
 * under the playhead again as it plays, and a seekable track with the time.
 *
 * The waveform is the take's own, handed over by the recorder (`wave`) or
 * worked out from the recording (`take`), so the sound plays straight from
 * the `<audio>` element and nothing here depends on Web Audio hearing it: an
 * iPhone's player for WebM gives Web Audio nothing to tap.
 *
 * Takes the place of the browser's `<audio controls>`, which cannot seek or
 * show a length for a MediaRecorder file in Chrome (its header has none) and
 * looks different in every browser.
 */
export function VoicePlayback({
  src,
  wave,
  take,
  debug,
}: {
  src: string;
  /** The bars the take drew while recording (see useVoiceRecording). */
  wave?: readonly number[] | null;
  /**
   * The recording itself, to work the bars out from when there is no `wave`
   * or the meter heard nothing.
   */
  take?: Blob | null;
  /**
   * Shows the player's plumbing under it (see VoiceDebug), after whatever
   * the caller knows about the take.
   */
  debug?: VoiceReadings;
}) {
  const { audioRef, audioProps, playing, current, duration, toggle, seek } =
    useAudioPlayback();

  // --- The take's bars: as recorded, or else decoded from the file ---
  const recorded = useMemo(() => (wave && !isFlatWave(wave) ? wave : null), [wave]);
  const [decoded, setDecoded] = useState<{ take: Blob; bars: number[] } | null>(null);
  useEffect(() => {
    if (recorded || !take) return;
    let gone = false;
    void decodeTakeWave(take).then((bars) => {
      if (!gone && bars) setDecoded({ take, bars });
    });
    return () => {
      gone = true;
    };
  }, [recorded, take]);
  const bars = recorded ?? (decoded && decoded.take === take ? decoded.bars : NO_BARS);

  // --- Where the playhead is, read each frame ---
  // The element's clock while it plays; it ticks only a few times a second
  // in some browsers, so the time since its last tick is added on to keep
  // the tape gliding. At rest, the player's own position, which is 0 again
  // after the end while the element's clock still sits there.
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  const clockRef = useRef({ time: 0, at: 0 });
  const readWave = useCallback((): WaveFrame => {
    const el = audioRef.current;
    let seconds = currentRef.current;
    if (el && !el.paused && Number.isFinite(el.currentTime)) {
      const now = performance.now();
      const clock = clockRef.current;
      if (el.currentTime !== clock.time) {
        clock.time = el.currentTime;
        clock.at = now;
      }
      seconds = clock.time + Math.min(0.25, (now - clock.at) / 1000);
    }
    return { bars, position: seconds / WAVE_BAR_SECONDS };
  }, [audioRef, bars]);

  const inspect = useCallback((): VoiceReadings => {
    const el = audioRef.current;
    return {
      ...debug,
      audio: el
        ? `ready ${el.readyState}, net ${el.networkState}, ${el.paused ? "paused" : "playing"}`
        : "none",
      length: el ? String(el.duration) : "none",
      error: el?.error ? `${el.error.code} ${el.error.message}` : "none",
      wave: recorded
        ? `${bars.length} bars, as recorded`
        : bars.length
          ? `${bars.length} bars, from the file`
          : "none",
    };
  }, [audioRef, debug, recorded, bars]);

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div className="flex w-full flex-col items-center gap-8">
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
          onClick={toggle}
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

      {/* Starts where the recording left it, at the end of the take, and
          runs back to the start: the tape rewinding. */}
      <VoiceWaveform read={readWave} tone="play" moving={playing} from={bars.length} />

      <div className="w-full px-6">
        <div className="mx-auto max-w-xs">
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

      {debug && <VoiceDebug read={inspect} />}
    </div>
  );
}
