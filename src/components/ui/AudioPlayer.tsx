"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils/cn";

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A compact player for a voice note: play/pause, a seekable track and the
 * time. Replaces the browser's own `<audio controls>`, which collapses to a
 * sliver of track in a narrow chat bubble and looks different in every
 * browser.
 *
 * Its width is its own (w-56, never wider than the space it is given), so a
 * bubble that sizes itself to its contents still has room for the track.
 */
export function AudioPlayer({ src, className }: { src: string; className?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  /** True while forcing Chrome to work out a recorder file's length. */
  const probingRef = useRef(false);

  // A file straight from MediaRecorder (Chrome's webm) has no duration in its
  // header, so the element reports Infinity until it has read to the end.
  // Seeking far past the end makes it do that up front; the timeupdate that
  // follows carries the real length, and the playhead goes back to 0.
  const readDuration = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration)) {
      setDuration(el.duration);
      return;
    }
    probingRef.current = true;
    el.currentTime = 1e101;
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (probingRef.current) {
      if (!Number.isFinite(el.duration)) return;
      probingRef.current = false;
      setDuration(el.duration);
      el.currentTime = 0;
      return;
    }
    setCurrent(el.currentTime);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    return () => el?.pause();
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, []);

  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const t = Number(e.target.value);
    el.currentTime = t;
    setCurrent(t);
  }, []);

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  // The length before it plays, the position once it has started.
  const shown = playing || current > 0 ? current : duration;

  return (
    <div className={cn("flex w-56 max-w-full items-center gap-2.5", className)}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={readDuration}
        onDurationChange={() => {
          const d = audioRef.current?.duration;
          if (d && Number.isFinite(d) && !probingRef.current) setDuration(d);
        }}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white",
          "bg-[var(--color-brand)] transition-transform active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
        )}
      >
        {playing ? (
          <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} />
        ) : (
          <Play className="ml-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />
        )}
      </button>

      {/* The visible track is drawn; a transparent range input over it does
          the seeking, so dragging, tapping and arrow keys all come free. */}
      <div className="relative h-6 min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-text-tertiary)]/30">
          <div
            className="h-full rounded-full bg-[var(--color-brand)]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-brand)]"
          style={{ left: `${progress * 100}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          onChange={seek}
          disabled={!duration}
          aria-label="Seek"
          aria-valuetext={`${formatClock(current)} of ${formatClock(duration)}`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>

      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-secondary)]">
        {duration > 0 ? formatClock(shown) : "–:––"}
      </span>
    </div>
  );
}
