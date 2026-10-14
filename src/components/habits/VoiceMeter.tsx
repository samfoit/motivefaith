"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils/cn";

const METER_BARS = 24;

/**
 * Bars that follow an analyser's level: the live mic while a voice take
 * records, or the take itself while it plays back. Drawn straight onto the
 * bars' styles each frame rather than through state, which would re-render
 * the whole screen sixty times a second.
 */
export function VoiceMeter({
  analyserRef,
  active,
  tone = "record",
}: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  active: boolean;
  /** Red while recording, the brand colour while playing back. */
  tone?: "record" | "play";
}) {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bars = barsRef.current?.children;
    if (!bars) return;
    const reset = () => {
      for (const bar of Array.from(bars)) (bar as HTMLElement).style.transform = "scaleY(0.08)";
    };
    if (!active) {
      reset();
      return;
    }

    let frame: number;
    const data = new Uint8Array(128);
    const half = METER_BARS / 2;
    const draw = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        analyser.getByteFrequencyData(data);
        // Mirrored from the middle out: the lowest bins, where speech is
        // loudest, drive the centre bars and higher ones the edges, so the
        // shape is even rather than piled up at one end.
        for (let i = 0; i < bars.length; i++) {
          const band = Math.floor(Math.abs(i - (half - 0.5)));
          const bin = 1 + band * 2;
          const level = Math.min(1, ((data[bin] ?? 0) + (data[bin + 1] ?? 0)) / 2 / 190);
          (bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.08, level)})`;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      reset();
    };
  }, [analyserRef, active]);

  return (
    <div ref={barsRef} className="flex items-center gap-1 h-16" aria-hidden>
      {Array.from({ length: METER_BARS }, (_, i) => (
        <span
          key={i}
          className={cn(
            "block w-1.5 h-full rounded-full origin-center transition-[transform,background-color] duration-75",
            !active
              ? "bg-white/30"
              : tone === "play"
                ? "bg-[var(--color-brand)]"
                : "bg-red-500",
          )}
          style={{ transform: "scaleY(0.08)" }}
        />
      ))}
    </div>
  );
}
