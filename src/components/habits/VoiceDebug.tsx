"use client";

import { useEffect, useState } from "react";
import type { VoiceReadings } from "@/lib/utils/audio-level";

/**
 * The plumbing of a voice take, read out on the screen four times a second.
 *
 * For finding out on a phone, where there is no console, why a meter isn't
 * moving: whether the audio context is running, whether the mic is handing
 * over sound, and what format the take is in. Hidden until the mic on the
 * voice screen is tapped five times (see CameraCapture).
 */
export function VoiceDebug({ read }: { read: () => VoiceReadings }) {
  const [readings, setReadings] = useState<VoiceReadings>({});

  useEffect(() => {
    const t = setInterval(() => setReadings(read()), 250);
    return () => clearInterval(t);
  }, [read]);

  return (
    <dl
      data-testid="voice-debug"
      className="grid w-full max-w-xs grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-white/10 px-3 py-2 text-left font-mono text-[11px] leading-snug text-white/80"
    >
      {Object.entries(readings).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-white/50">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
