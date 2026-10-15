"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useThemeStore } from "@/lib/stores/theme-store";
import { BAND_H } from "@/lib/lamplight/sky";
import { SkyBand, SkyStarField } from "@/components/sky/SkyDrawing";
import { isThreadRoute } from "@/lib/utils/thread-route";

/**
 * The sky behind every /main screen: stars by night, the sun's low arc by
 * day, hills and still water at the bottom. It is fixed to the viewport and
 * the page scrolls over it on solid cards, so it never sits behind text; the
 * layout leaves room under the last card so scrolling to the end of any list
 * shows the whole scene.
 *
 * Two layers. The star field tiles at native size from the top of the screen
 * to the nav, so stars stay pin-points on any width. The horizon band is a
 * 390×220 drawing pinned above the nav; its hills and water run far past both
 * edges, so it fills any width without stretching.
 *
 * Colors come from the `--sky-*` properties the palette writes for the hour;
 * positions and opacities come from sky(hour). The hour is the theme store's:
 * the clock in "Auto" mode, a clear midday or a lamplit night when pinned.
 *
 * Client-only. The server does not know the viewer's hour, and the ground
 * behind this is already the right color from the init script, so the sky
 * fades in after hydration rather than risk a mismatch.
 *
 * The drawings themselves live in components/sky/SkyDrawing.tsx, shared with
 * the landing page.
 */

export function SkyScene() {
  const [mounted, setMounted] = React.useState(false);
  const hour = useThemeStore((s) => s.hour);
  const pathname = usePathname();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // Thread screens keep a composer fixed over the band: stars only there.
  const showBand = !isThreadRoute(pathname);

  return (
    <div aria-hidden="true" className="sky-enter pointer-events-none fixed inset-0 -z-10">
      <SkyStarField
        hour={hour}
        idPrefix="sky"
        className="absolute inset-x-0 top-0 w-full"
        style={{ height: "calc(100% - 4rem - env(safe-area-inset-bottom))" }}
      />
      {showBand && (
        <SkyBand
          hour={hour}
          idPrefix="sky"
          className="absolute inset-x-0 w-full"
          style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))", height: BAND_H }}
        />
      )}
    </div>
  );
}

/** The hills and water are about this tall above the nav. */
const CLEARANCE = "11rem";

/**
 * Room at the end of every list for the whole scene: a long list scrolls over
 * the fixed hills, so without this its last card would sit on them for good.
 * A short list that fits never scrolls, so the room costs nothing there.
 *
 * Not on thread screens. Their composer is fixed over the band and the band
 * is not drawn, so the room would only be empty scroll under the last message.
 */
export function SkyClearance() {
  const pathname = usePathname();
  if (isThreadRoute(pathname)) return null;
  return <div aria-hidden="true" style={{ height: CLEARANCE }} />;
}
