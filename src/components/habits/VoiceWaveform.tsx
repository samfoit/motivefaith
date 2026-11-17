"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";

/** What the waveform draws on a frame. */
export interface WaveFrame {
  bars: readonly number[];
  /** Where the playhead is in the take, in bars. */
  position: number;
  /** The bar still filling under the playhead while a take records. */
  forming?: number;
}

/**
 * - `idle`: an empty tape, before a take.
 * - `record`: bars are born at a red playhead and slide away to the left.
 * - `paused`: the tape stops and the playhead goes quiet.
 * - `play`: the same tape runs under the playhead again, lit up to where it
 *   has been heard.
 */
export type WaveTone = "idle" | "record" | "paused" | "play";

const PITCH = 4;
const BAR_WIDTH = 2.5;
/** Bars stop short of the canvas edge, and the playhead runs the full height. */
const INSET = 6;
const RECORD_RED = "#ef4444";
const LAMP_FALLBACK = "#E9B44C";
/** Seconds for the tape to close most of the distance to where it was sent. */
const GLIDE_SECONDS = 0.11;

/**
 * A voice take as a tape of loudness bars running under a fixed playhead:
 * the way a phone's voice memo shows it. Recording and review draw the same
 * tape, so what was watched going in is what is watched coming back out.
 *
 * Drawn on a canvas straight from `read` each frame, never through state:
 * a take is redrawn sixty times a second.
 */
export function VoiceWaveform({
  read,
  tone,
  moving,
  from,
  className,
}: {
  /** The tape as it stands now. Called every frame, so it must be cheap. */
  read: () => WaveFrame;
  tone: WaveTone;
  /**
   * The playhead is running in real time (recording or playing) and is
   * followed exactly. Otherwise the tape glides to wherever it is sent: a
   * seek, or the rewind when playback ends.
   */
  moving: boolean;
  /** Where the tape sits when first drawn, before gliding to `read`'s position. */
  from?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Where the tape is drawn, which trails `read`'s position while gliding. */
  const shownRef = useRef<number | null>(from ?? null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lamp =
      getComputedStyle(canvas).getPropertyValue("--color-brand").trim() || LAMP_FALLBACK;
    const colors = {
      past: tone === "play" ? lamp : "rgba(255,255,255,0.92)",
      ahead: "rgba(255,255,255,0.32)",
      tape: "rgba(255,255,255,0.16)",
      head:
        tone === "record"
          ? RECORD_RED
          : tone === "play"
            ? "#fff"
            : "rgba(255,255,255,0.45)",
    };

    let width = 0;
    let height = 0;
    let ratio = 1;
    /** What the last frame drew, so a tape at rest is not redrawn. */
    let drawn = "";
    const fit = () => {
      ratio = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      drawn = "";
    };

    const rounded = typeof ctx.roundRect === "function";
    const bar = (x: number, level: number) => {
      const h = Math.max(BAR_WIDTH, level * (height - INSET * 2));
      const left = x - BAR_WIDTH / 2;
      const top = (height - h) / 2;
      if (rounded) ctx.roundRect(left, top, BAR_WIDTH, h, BAR_WIDTH / 2);
      else ctx.rect(left, top, BAR_WIDTH, h);
    };

    let frame = 0;
    let last = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const { bars, position, forming } = read();
      const target = tone === "play" ? Math.min(position, bars.length || position) : position;

      let shown = shownRef.current ?? target;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (moving || still || Math.abs(target - shown) < 0.01) shown = target;
      else shown += (target - shown) * (1 - Math.exp(-dt / GLIDE_SECONDS));
      shownRef.current = shown;

      const key = `${shown.toFixed(3)}|${bars.length}|${(forming ?? 0).toFixed(3)}`;
      if (key === drawn || !width) return;
      drawn = key;

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const centre = width / 2;
      const first = Math.floor(shown - centre / PITCH) - 1;
      const lastBar = Math.ceil(shown + centre / PITCH) + 1;
      // A take being recorded has no end yet, so its tape runs on blank to
      // both edges. One being played back shows where it starts and stops.
      const endless = tone !== "play" || bars.length === 0;
      const heard = Math.min(bars.length, Math.ceil(shown));

      const pass = (color: string, wants: (i: number) => boolean, level: (i: number) => number) => {
        ctx.beginPath();
        for (let i = first; i <= lastBar; i++) {
          if (wants(i)) bar(centre + (i + 0.5 - shown) * PITCH, level(i));
        }
        ctx.fillStyle = color;
        ctx.fill();
      };

      if (endless) {
        pass(colors.tape, (i) => i < 0 || i > bars.length || (i === bars.length && !forming), () => 0);
      }
      pass(colors.past, (i) => i >= 0 && i < heard, (i) => bars[i]);
      pass(colors.ahead, (i) => i >= heard && i < bars.length, (i) => bars[i]);
      // The bar still filling: red under the playhead while the mic is live.
      if (forming && tone !== "play") {
        pass(tone === "record" ? colors.head : colors.past, (i) => i === bars.length, () => forming);
      }

      ctx.fillStyle = colors.head;
      ctx.fillRect(centre - 0.75, 0, 1.5, height);
    };

    fit();
    // Safari before 13.1 has no ResizeObserver; a turned phone still resizes
    // the window.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    resize?.observe(canvas);
    window.addEventListener("resize", fit);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [read, tone, moving]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("block h-24 w-full max-w-2xl", className)}
      style={{
        // The tape runs off under the edges instead of being cut by them.
        maskImage: EDGE_FADE,
        WebkitMaskImage: EDGE_FADE,
      }}
    />
  );
}

const EDGE_FADE = "linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)";
