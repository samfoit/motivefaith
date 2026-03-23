"use client";

import { useEffect, useRef } from "react";

const COLORS = [
  "#f59e0b", // streak amber
  "#6366f1", // brand indigo
  "#22c55e", // success green
  "#8b5cf6", // encourage purple
  "#ec4899", // pink
  "#3b82f6", // blue
];

// 14 particles (down from 40) — sufficient visual impact, far fewer repaints
const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const hash = ((i * 7 + 13) * 2654435761) >>> 0;
  const hash2 = ((i * 11 + 3) * 2654435761) >>> 0;
  const hash3 = ((i * 5 + 17) * 2654435761) >>> 0;
  const angle = (i / 14) * Math.PI * 2 + ((hash % 100) / 100) * 0.3;
  return {
    angle,
    radius: 120 + (hash % 160),
    duration: 0.6 + (hash2 % 100) * 0.006,
    delay: (hash3 % 100) * 0.002,
    size: 4 + (hash % 6),
    color: COLORS[i % COLORS.length],
    // Pre-compute end positions for CSS custom properties
    endX: Math.cos(angle) * (120 + (hash % 160)),
    endY: Math.sin(angle) * (120 + (hash % 160)),
  };
});

const AUTO_DISMISS_MS = 1600;

interface StreakCelebrationProps {
  active: boolean;
  onDone: () => void;
}

export function StreakCelebration({ active, onDone }: StreakCelebrationProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(onDone, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [active, onDone]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center"
      style={{ animation: `streak-container-fade ${AUTO_DISMISS_MS}ms forwards` }}
    >
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            willChange: "transform, opacity",
            animation: `streak-particle ${p.duration}s ease-out ${p.delay}s forwards`,
            "--end-x": `${p.endX}px`,
            "--end-y": `${p.endY}px`,
          } as React.CSSProperties}
        />
      ))}

      {/* Keyframes defined in globals.css (streak-particle, streak-container-fade) */}
    </div>
  );
}
