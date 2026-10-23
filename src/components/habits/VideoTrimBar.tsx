"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils/cn";

export interface VideoTrimBarProps {
  /** The whole video's length, in seconds. */
  duration: number;
  /** How much of it is sent, in seconds: the window's width. */
  length: number;
  /** Where the window starts, in seconds. */
  start: number;
  /** While the window moves, by drag or by key. */
  onChange: (start: number) => void;
  /** Where it was let go: when the preview plays the part again. */
  onCommit: (start: number) => void;
}

/** Keys that move the window, by how many seconds. */
const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
  PageDown: -5,
  PageUp: 5,
};

/** Keep a window `length` long inside a video `duration` long. */
export function clampTrimStart(start: number, duration: number, length: number): number {
  return Math.min(Math.max(0, start), Math.max(0, duration - length));
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Which part of a long video to send: a window as long as a video may be,
 * dragged along a track standing for the whole of it, the way a phone's own
 * trimmer works. The preview above it shows where it is.
 */
export function VideoTrimBar({ duration, length, start, onChange, onCommit }: VideoTrimBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  /** How far into the window the finger took hold of it, in pixels. */
  const gripRef = useRef<number | null>(null);

  const end = Math.min(duration, start + length);

  const startUnder = (clientX: number, grip: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return clampTrimStart(
      ((clientX - rect.left - grip) / rect.width) * duration,
      duration,
      length,
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const left = (start / duration) * rect.width;
    const width = (length / duration) * rect.width;
    const x = e.clientX - rect.left;
    // Taken inside the window, it moves from where it was taken; anywhere
    // else on the track, it centres on the finger first.
    const grip = x >= left && x <= left + width ? x - left : width / 2;
    gripRef.current = grip;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onChange(startUnder(e.clientX, grip));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gripRef.current === null) return;
    onChange(startUnder(e.clientX, gripRef.current));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gripRef.current === null) return;
    const next = startUnder(e.clientX, gripRef.current);
    gripRef.current = null;
    onCommit(next);
  };

  const handlePointerCancel = () => {
    if (gripRef.current === null) return;
    gripRef.current = null;
    onCommit(start);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (e.key in KEY_STEPS) next = start + KEY_STEPS[e.key];
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = duration;
    else return;
    e.preventDefault();
    const clamped = clampTrimStart(next, duration, length);
    onChange(clamped);
    onCommit(clamped);
  };

  return (
    <div className="w-full">
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="relative h-11 rounded-lg bg-white/10 select-none"
        style={{ touchAction: "none" }}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label="Part of the video to send"
          aria-valuemin={0}
          aria-valuemax={Math.round(Math.max(0, duration - length))}
          aria-valuenow={Math.round(start)}
          aria-valuetext={`${clock(start)} to ${clock(end)}`}
          onKeyDown={handleKeyDown}
          className={cn(
            "absolute inset-y-0 flex items-center justify-center gap-1",
            "rounded-lg border-2 border-white bg-white/20",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
            "focus-visible:ring-offset-2 focus-visible:ring-offset-black",
          )}
          style={{
            left: `${(start / duration) * 100}%`,
            width: `${(Math.min(length, duration) / duration) * 100}%`,
          }}
        >
          {/* A grip, so the window reads as something to drag */}
          <span aria-hidden className="h-4 w-0.5 rounded-full bg-white/70" />
          <span aria-hidden className="h-4 w-0.5 rounded-full bg-white/70" />
        </div>
      </div>
      <p className="mt-2 text-center text-white/60 text-xs tabular-nums">
        {clock(start)} – {clock(end)} of {clock(duration)}
      </p>
    </div>
  );
}
