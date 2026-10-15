import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The shared look for every link preview the app produces.
 *
 * Satori — what `next/og` renders with — supports TTF, OTF and WOFF, but not
 * WOFF2, which is the only format `next/font` leaves on disk. So the faces are
 * vendored here as latin-subset WOFF (from @fontsource, OFL-1.1) rather than fetched
 * from Google at render time: an OG image that depends on an outbound request
 * fails silently, and a link preview that fails is one nobody ever sees is
 * broken.
 *
 * Paths are string literals so Next's file tracing can find them; next.config
 * also names the directory in `outputFileTracingIncludes` as a belt to that
 * brace, because a missing font here is a runtime error, not a build one.
 */
const FONT_DIR = join(process.cwd(), "src/app/_fonts");

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export async function ogFonts() {
  const [display, regular, semibold] = await Promise.all([
    readFile(join(FONT_DIR, "Newsreader-Medium.woff")),
    readFile(join(FONT_DIR, "Figtree-Regular.woff")),
    readFile(join(FONT_DIR, "Figtree-SemiBold.woff")),
  ]);

  return [
    { name: "Newsreader", data: display, weight: 500 as const, style: "normal" as const },
    { name: "Figtree", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Figtree", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
}

// Lamplight's night: the same values as the Dark pin in src/styles/tokens.css.
const GROUND = "#12151F";
const GROUND_HIGH = "#1E2540";
const INK = "#EDE6D6";
const MUTED = "#A9A190";
const LAMP = "#E9B44C";
const ON_LAMP = "#1A1405";
const UNLIT = "#2E3446";

// A few stars in the corner the lamp's glow does not reach.
const STARS: [number, number, number][] = [
  [1010, 96, 3], [1090, 150, 2], [960, 190, 2], [1120, 70, 2.5], [1050, 250, 2],
  [890, 110, 1.5], [1140, 220, 1.5],
];

/** The app icon's mark: the flame over the cross, in lamp gold. */
function LampMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <defs>
        <linearGradient id="og-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GROUND_HIGH} />
          <stop offset="100%" stopColor={GROUND} />
        </linearGradient>
        <radialGradient id="og-halo" cx="256" cy="178" r="170" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={LAMP} stopOpacity="0.34" />
          <stop offset="100%" stopColor={LAMP} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="108" fill="url(#og-ground)" />
      <circle cx="256" cy="178" r="170" fill="url(#og-halo)" />
      <path
        d="M256 80C256 80 208 140 208 190C208 216 230 240 256 240C282 240 304 216 304 190C304 140 256 80 256 80Z"
        fill="#F2CF84"
      />
      <path
        d="M200 248H312A24 24 0 0 1 312 296H280V408A24 24 0 0 1 232 408V296H200A24 24 0 0 1 200 248Z"
        fill={LAMP}
      />
    </svg>
  );
}

/**
 * One card, two uses: a named invite and the app's own default preview.
 *
 * `headline` is the only thing that changes between them, which is deliberate
 * — a preview that looks like a different product depending on which link you
 * followed is a preview that does not build recognition.
 *
 * Drawn as the app's night: a lamplit ground, the icon's mark, Newsreader for
 * the message. A dark card also stands apart in the light feeds where most
 * link previews land.
 */
export function OgCard({
  headline,
  subhead,
  pill,
}: {
  headline: string;
  subhead: string;
  pill: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        position: "relative",
        background: GROUND,
        backgroundImage: `radial-gradient(circle at 12% 0%, rgba(233, 180, 76, 0.16) 0%, rgba(233, 180, 76, 0) 45%), linear-gradient(180deg, ${GROUND_HIGH} 0%, ${GROUND} 70%)`,
        fontFamily: "Figtree",
        color: INK,
      }}
    >
      {STARS.map(([x, y, r]) => (
        <div
          key={`${x}-${y}`}
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: r * 2,
            height: r * 2,
            borderRadius: 999,
            background: INK,
            opacity: 0.7,
          }}
        />
      ))}

      {/* Wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <LampMark size={64} />
        <div style={{ fontFamily: "Newsreader", fontSize: 34, fontWeight: 500, color: INK }}>
          MotiveFaith
        </div>
      </div>

      {/* Message */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontFamily: "Newsreader",
            fontSize: 76,
            fontWeight: 500,
            color: INK,
            letterSpacing: -1.5,
            lineHeight: 1.05,
          }}
        >
          {headline}
        </div>
        <div
          style={{
            fontSize: 34,
            color: MUTED,
            marginTop: 22,
            lineHeight: 1.3,
            maxWidth: 820,
          }}
        >
          {subhead}
        </div>
      </div>

      {/* Footer: the call, and a week of kept days behind it — the product's
          own vocabulary, so the preview reads as this app and not as any
          invite card. Kept days are lit lamps. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 32px",
            borderRadius: 999,
            background: LAMP,
            color: ON_LAMP,
            fontSize: 28,
            fontWeight: 600,
            boxShadow: "0 0 36px rgba(233, 180, 76, 0.35)",
          }}
        >
          {pill}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                background: i < 5 ? LAMP : UNLIT,
                boxShadow: i < 5 ? "0 0 14px rgba(233, 180, 76, 0.45)" : "none",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
