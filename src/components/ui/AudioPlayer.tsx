"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAudioPlayback } from "@/lib/hooks/useAudioPlayback";
import { WAVE_BAR_SECONDS, decodeTakeWave, summarizeWave } from "@/lib/utils/voice-wave";

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A note's width follows its length, so a long one looks long before its
 * time is read: the shortest are 160px, and it grows on a log scale (a few
 * seconds more matters on a short note, not on a long one) to 256px at a
 * minute and over. Never wider than the space it is given.
 */
const MIN_WIDTH = 160;
const MAX_WIDTH = 256;
const SHORT_SECONDS = 3;
const LONG_SECONDS = 60;
/** The play button, the time and the gaps between them. */
const AROUND_TRACK = 36 + 36 + 2 * 10;
/** The recorder's bar pitch, so a sent note's bars are spaced like the take's. */
const PITCH = 4;

export function noteWidth(seconds: number): number {
  if (!(seconds > 0)) return MIN_WIDTH;
  const t = Math.log(seconds / SHORT_SECONDS) / Math.log(LONG_SECONDS / SHORT_SECONDS);
  return Math.round(MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * Math.min(1, Math.max(0, t)));
}

/**
 * Notes' bars, worked out once per note and kept for the session, so a note
 * scrolled past again or shown in both the feed and a chat is decoded once.
 * A note that couldn't be read is forgotten, to be tried again next time.
 */
const waves = new Map<string, Promise<number[] | null>>();
const MAX_WAVES = 100;

function loadWave(src: string, key: string): Promise<number[] | null> {
  const known = waves.get(key);
  if (known) return known;
  const loading = fetch(src)
    .then((res) => (res.ok ? res.blob() : null))
    .then((blob) => (blob ? decodeTakeWave(blob) : null))
    .catch(() => null)
    .then((bars) => {
      if (!bars) waves.delete(key);
      return bars;
    });
  waves.set(key, loading);
  if (waves.size > MAX_WAVES) waves.delete(waves.keys().next().value!);
  return loading;
}

/**
 * A compact player for a voice note: play/pause, the note's own waveform,
 * which is also the seek track, and the time. Drawn in the hour's ink like
 * the capture screen's review is in white: bright where it has been heard,
 * faint ahead. The gold stays with the actions around it.
 *
 * The bars are worked out from the file once the note comes near the
 * screen, since only the file is kept; until then, or if the browser can't
 * read it, the track is the recorder's empty tape, a row of dots. Takes the
 * place of the browser's own `<audio controls>`, which collapses to a sliver
 * of track in a narrow chat bubble and looks different in every browser.
 *
 * Its width is its own (see noteWidth), so a bubble that sizes itself to
 * its contents still has room for the track.
 */
export function AudioPlayer({
  src,
  waveKey,
  className,
  onError,
}: {
  src: string;
  /** What the note is, beyond this link to it (a storage path), for the bars' cache. */
  waveKey?: string;
  className?: string;
  /** The file would not load: an expired link, or one that went away. */
  onError?: () => void;
}) {
  const { audioProps, playing, current, duration, toggle, seek } = useAudioPlayback();
  const key = waveKey ?? src;

  // --- The note's bars, read from the file once it is near the screen ---
  const rootRef = useRef<HTMLDivElement>(null);
  const [wave, setWave] = useState<{ key: string; bars: number[] } | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let gone = false;
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        near.disconnect();
        void loadWave(src, key).then((bars) => {
          if (!gone && bars) setWave({ key, bars });
        });
      },
      { rootMargin: "200px" },
    );
    near.observe(el);
    return () => {
      gone = true;
      near.disconnect();
    };
  }, [src, key]);
  const bars = wave && wave.key === key ? wave.bars : null;

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  // The length before it plays, the position once it has started. A note
  // whose length the player doesn't know yet (see useAudioPlayback) shows
  // the length its bars add up to, and still counts up once playing.
  const started = playing || current > 0;
  const length = duration > 0 ? duration : bars ? bars.length * WAVE_BAR_SECONDS : 0;
  const shown = started ? current : length;
  const width = noteWidth(length);

  // --- As many bars as the track has room for, at the recorder's pitch ---
  // Measured, because a narrow bubble can hold the player under its width.
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sizes = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
    sizes.observe(el);
    return () => sizes.disconnect();
  }, []);
  const count = Math.max(8, Math.floor((trackWidth ?? width - AROUND_TRACK) / PITCH));
  const columns = useMemo(
    () => (bars ? summarizeWave(bars, count) : Array.from({ length: count }, () => 0)),
    [bars, count],
  );

  return (
    <div
      ref={rootRef}
      className={cn("flex max-w-full items-center gap-2.5", className)}
      style={{ width }}
    >
      <audio src={src} onError={onError} {...audioProps} />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          "bg-[var(--color-text-primary)] text-[var(--color-bg-elevated)] transition-transform active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
        )}
      >
        {playing ? (
          <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} />
        ) : (
          <Play className="ml-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />
        )}
      </button>

      {/* The waveform is the track: drawn faint, then again bright and cut
          off at the playhead. A transparent range input over it does the
          seeking, so dragging, tapping and arrow keys all come free. */}
      <div ref={trackRef} className="relative h-7 min-w-0 flex-1 text-[var(--color-text-primary)]">
        <Bars columns={columns} className="opacity-30" />
        <Bars
          columns={columns}
          className={cn(
            "opacity-90",
            playing && "motion-safe:transition-[clip-path] motion-safe:duration-300 motion-safe:ease-linear",
          )}
          style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
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

      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-secondary)]">
        {length > 0 || started ? formatClock(shown) : "–:––"}
      </span>
    </div>
  );
}

/** One layer of the note's bars, in the current text color. */
function Bars({
  columns,
  className,
  style,
}: {
  columns: readonly number[];
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 flex items-center justify-between", className)}
      style={style}
    >
      {columns.map((level, i) => (
        <span
          key={i}
          className="w-[2.5px] shrink-0 rounded-full bg-current"
          style={{ height: `max(2.5px, ${level * 100}%)` }}
        />
      ))}
    </div>
  );
}
