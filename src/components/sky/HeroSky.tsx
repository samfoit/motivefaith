"use client";

import { useIsClient } from "@/lib/hooks/useIsClient";
import { useThemeStore } from "@/lib/stores/theme-store";
import { BAND_H } from "@/lib/lamplight/sky";
import { SkyBand, SkyStarField } from "./SkyDrawing";

/**
 * The live sky behind the landing page's hero: the same hour as the app's
 * colors, so a visitor at dusk sees the sun setting over the hills before
 * they have signed up for anything.
 *
 * Fills its positioned parent; the hills sit along its bottom edge. Client
 * only and faded in after hydration, for the same reason as SkyScene: the
 * server cannot know the visitor's hour.
 */
export function HeroSky() {
  const mounted = useIsClient();
  const hour = useThemeStore((s) => s.hour);

  if (!mounted) return null;

  return (
    <div aria-hidden="true" className="sky-enter pointer-events-none absolute inset-0 overflow-hidden">
      <SkyStarField hour={hour} idPrefix="hero" className="absolute inset-0 h-full w-full" />
      {/* Phone-sized on a phone; larger on a wide screen, where the 390px
          drawing would otherwise be a thin strip under a lot of sky. */}
      <SkyBand
        hour={hour}
        idPrefix="hero"
        className="absolute inset-x-0 bottom-0 w-full h-[var(--band-h)] lg:h-[calc(var(--band-h)*1.4)]"
        style={{ ["--band-h" as string]: `${BAND_H}px` }}
      />
    </div>
  );
}
