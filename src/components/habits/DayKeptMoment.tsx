"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDayKeptStore } from "@/lib/stores/day-kept-store";
import { useThemeStore } from "@/lib/stores/theme-store";
import { dayKeptSummary, type DayKept } from "@/lib/day-kept";
import { SkyBand } from "@/components/sky/SkyDrawing";
import { BAND_H } from "@/lib/lamplight/sky";

/**
 * The day's last habit, settled: for a few seconds the app turns to the
 * hour's own page — its ground, its horizon — and one flame per habit is lit
 * on it, the one just finished last.
 *
 * Mounted once by the authenticated layout, so it plays the same wherever
 * the last check-in was made: the dashboard in any view, a habit's page, the
 * camera. Those offer the moment through `useDayKeptStore`; nothing here
 * knows which it was.
 *
 * It never has to be answered. It leaves on its own, or at a tap or Escape.
 * Toasts stay above it (z-50 to its z-45), so a quick check-in's Undo is
 * still there to press.
 */

/**
 * Before anything shows: long enough for the card's check to land, or the
 * sheet or camera the check-in came from to close.
 */
const START_DELAY_MS = 450;
/** On screen once the last flame is lit: time to read two short lines. */
const HOLD_MS = 3000;
/** Matches `day-kept-out` in globals.css. */
const EXIT_MS = 240;

/** The mark's flame, as the app icon and the link previews draw it. */
const FLAME_PATH =
  "M256 80C256 80 208 140 208 190C208 216 230 240 256 240C282 240 304 216 304 190C304 140 256 80 256 80Z";

/**
 * When each flame is lit, in milliseconds from the page appearing. The ones
 * settled earlier in the day come up together, quickly; a beat later the
 * ones this check-in settled are lit in turn.
 */
function lightingTimes(flames: DayKept["flames"]): { at: number[]; lit: number } {
  const settled = flames.filter((f) => !f.fresh).length;
  const step = settled > 0 ? Math.min(90, 540 / settled) : 0;
  const freshFrom = 200 + settled * step + (settled > 0 ? 160 : 0);
  let fresh = 0;
  const at = flames.map((f, i) =>
    f.fresh ? freshFrom + fresh++ * 130 : 200 + i * step,
  );
  return { at, lit: Math.max(...at, 200) };
}

/** Smaller flames for a longer day, so a row of them still fits a phone. */
function flameHeight(count: number): number {
  if (count <= 4) return 64;
  if (count <= 7) return 48;
  return 36;
}

function Flame({
  state,
  fresh,
  at,
  index,
}: {
  state: "done" | "rain";
  fresh: boolean;
  at: number;
  index: number;
}) {
  return (
    <span
      className="day-kept-flame"
      data-fresh={fresh || undefined}
      style={{ "--at": `${at}ms` } as React.CSSProperties}
    >
      <svg
        viewBox="200 72 112 176"
        className={state === "done" ? "day-kept-flicker" : undefined}
        // Out of step with its neighbors: a row flickering in unison reads
        // as one blinking sign.
        style={{ animationDelay: `${at + 400 - (index % 4) * 370}ms` }}
      >
        {state === "done" ? (
          <>
            <path d={FLAME_PATH} fill="var(--color-brand)" />
            {/* The paler heart of the flame, as the mark's tip is paler. */}
            <path
              d={FLAME_PATH}
              transform="translate(256 232) scale(0.46) translate(-256 -240)"
              fill="color-mix(in oklab, var(--color-brand) 45%, white)"
            />
          </>
        ) : (
          // A rain check: the place kept, not lit. The habit card's ring.
          <path
            d={FLAME_PATH}
            fill="none"
            stroke="var(--color-rain)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </span>
  );
}

function Moment({ moment, onDone }: { moment: DayKept; onDone: () => void }) {
  const hour = useThemeStore((s) => s.hour);
  const [phase, setPhase] = useState<"waiting" | "shown" | "leaving">("waiting");
  const { at, lit } = lightingTimes(moment.flames);

  useEffect(() => {
    const show = setTimeout(() => {
      setPhase("shown");
      // Two soft taps where the device has them (Android); a no-op elsewhere.
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([10, 90, 16]);
      }
    }, START_DELAY_MS);
    const leave = setTimeout(
      () => setPhase("leaving"),
      START_DELAY_MS + lit + HOLD_MS,
    );
    return () => {
      clearTimeout(show);
      clearTimeout(leave);
    };
  }, [lit]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const done = setTimeout(onDone, EXIT_MS);
    return () => clearTimeout(done);
  }, [phase, onDone]);

  const leave = useCallback(
    () => setPhase((p) => (p === "shown" ? "leaving" : p)),
    [],
  );

  useEffect(() => {
    if (phase !== "shown") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, leave]);

  if (phase === "waiting") return null;

  return createPortal(
    <div
      role="status"
      className="day-kept fixed inset-0 z-[45] overflow-hidden bg-bg-primary"
      data-leaving={phase === "leaving" || undefined}
      style={{ "--lit": `${lit}ms` } as React.CSSProperties}
      onPointerDown={leave}
    >
      <SkyBand
        hour={hour}
        idPrefix="day-kept"
        className="day-kept-band absolute inset-x-0 w-full"
        style={{ bottom: "env(safe-area-inset-bottom)", height: BAND_H }}
      />

      {/* On the flat ground above the band: nothing here sits on the sky. */}
      <div
        className="absolute inset-x-0 top-0 flex flex-col items-center justify-center px-6 pt-safe text-center"
        style={{ bottom: `calc(${BAND_H}px + env(safe-area-inset-bottom))` }}
      >
        <div
          aria-hidden="true"
          className="relative flex max-w-[19rem] flex-wrap items-end justify-center"
          style={
            {
              "--flame-h": `${flameHeight(moment.flames.length)}px`,
              gap: moment.flames.length <= 4 ? "1rem" : "0.75rem",
            } as React.CSSProperties
          }
        >
          <span className="day-kept-halo" />
          {moment.flames.map((flame, i) => (
            <Flame
              key={flame.id}
              state={flame.state}
              fresh={flame.fresh}
              at={at[i]}
              index={i}
            />
          ))}
        </div>

        <h2 className="day-kept-line mt-8 font-display text-[2rem] font-medium leading-tight tracking-[-0.025em] text-text-primary">
          Today is kept.
        </h2>
        <p className="day-kept-line day-kept-line--sub mt-2 text-base text-text-secondary">
          {dayKeptSummary(moment)}
        </p>
      </div>
    </div>,
    document.body,
  );
}

export function DayKeptMoment() {
  const moment = useDayKeptStore((s) => s.moment);
  const dismiss = useDayKeptStore((s) => s.dismiss);

  if (!moment) return null;
  // Keyed, so a day un-kept and kept again starts over from the top.
  return <Moment key={moment.id} moment={moment} onDone={dismiss} />;
}
