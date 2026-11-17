"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils/cn";

/** Loudness, in dB of full scale, that leaves the halo at rest or at full swell. */
const HALO_FLOOR_DB = -55;
const HALO_PEAK_DB = -18;
/** How far past the disc the halo reaches at full voice. */
const HALO_REACH = 0.5;

/**
 * A soft disc behind the mic that swells with the voice's loudness, so a
 * speaker sees from across the screen that they are being heard, not only
 * in the waveform below. It rises fast and settles slowly, as a level meter
 * does, so it reads as breath rather than flicker. With reduced motion it
 * stays still and the waveform carries the level alone.
 */
export function VoiceHalo({
  analyserRef,
  active,
  className,
  children,
}: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  active: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const haloRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const halo = haloRef.current;
    if (!halo) return;
    const rest = () => {
      halo.style.transform = "scale(1)";
      halo.style.opacity = "0";
    };
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      rest();
      return;
    }

    let frame: number;
    let shown = 0;
    let samples: Float32Array<ArrayBuffer> | null = null;
    const draw = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        if (!samples || samples.length !== analyser.fftSize) {
          samples = new Float32Array(analyser.fftSize);
        }
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += s * s;
        const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6);
        const level = Math.min(1, Math.max(0, (db - HALO_FLOOR_DB) / (HALO_PEAK_DB - HALO_FLOOR_DB)));
        shown += (level - shown) * (level > shown ? 0.5 : 0.12);
        halo.style.transform = `scale(${1 + shown * HALO_REACH})`;
        halo.style.opacity = String(Math.min(1, shown * 1.6));
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      rest();
    };
  }, [analyserRef, active]);

  return (
    <div className={cn("relative", className)}>
      <span
        ref={haloRef}
        aria-hidden
        className="absolute inset-0 rounded-full bg-red-500/25"
        style={{ transform: "scale(1)", opacity: 0 }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
