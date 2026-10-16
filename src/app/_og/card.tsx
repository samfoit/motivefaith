import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";

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

// Lamplight's night: the NIGHT stop in src/lib/lamplight/palette.ts. Flat
// color only; no gradients or glow.
const GROUND = "#12151F";
const TILE = "#232838";
const INK = "#EDE6D6";
const SUB = "#A9A190";
const LINE = "#5C6480";
const LAMP = "#E9B44C";
const FLAME = "#F2CF84";

const FLAME_PATH =
  "M256 80C256 80 208 140 208 190C208 216 230 240 256 240C282 240 304 216 304 190C304 140 256 80 256 80Z";

/** The app icon's mark: the flame over the cross, in lamp gold. */
function LampMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <rect width="512" height="512" rx="108" fill={TILE} />
      <path d={FLAME_PATH} fill={FLAME} />
      <path
        d="M200 248H312A24 24 0 0 1 312 296H280V408A24 24 0 0 1 232 408V296H200A24 24 0 0 1 200 248Z"
        fill={LAMP}
      />
    </svg>
  );
}

/** The mark's flame. Lit is solid gold; unlit is an outline, a place kept. */
function Flame({ size, lit }: { size: number; lit: boolean }) {
  const w = size * (112 / 176);
  return (
    <svg width={w} height={size} viewBox="200 72 112 176">
      <path
        d={FLAME_PATH}
        fill={lit ? FLAME : "none"}
        stroke={lit ? "none" : LINE}
        strokeWidth={lit ? 0 : 6}
      />
    </svg>
  );
}

function Caption({ children, lit = false }: { children: ReactNode; lit?: boolean }) {
  return (
    <div
      style={{
        display: "block",
        maxWidth: 190,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        fontSize: 22,
        fontWeight: 600,
        marginTop: 16,
        color: lit ? INK : SUB,
      }}
    >
      {children}
    </div>
  );
}

/** A week of kept days: the product's own picture of a streak. */
export function WeekScene() {
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <div style={{ display: "flex", gap: 14 }}>
      {days.map((day, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Flame size={48} lit={i < 5} />
          <Caption lit={i < 5}>{day}</Caption>
        </div>
      ))}
    </div>
  );
}

/** Their flame lit, yours waiting beside it. */
export function PairScene({ name }: { name: string }) {
  return (
    <div style={{ display: "flex", gap: 44, alignItems: "flex-end" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Flame size={110} lit />
        <Caption lit>{name}</Caption>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Flame size={110} lit={false} />
        <Caption>You</Caption>
      </div>
    </div>
  );
}

/** A circle already lit, with one place open. */
export function CircleScene() {
  const ring: [number, number, boolean][] = [
    [110, 0, true], [200, 50, true], [200, 150, true], [110, 200, false], [20, 150, true], [20, 50, true],
  ];
  return (
    <div style={{ display: "flex", position: "relative", width: 260, height: 290 }}>
      {ring.map(([x, y, lit], i) => (
        <div
          key={i}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "absolute", left: x, top: y }}
        >
          <Flame size={60} lit={lit} />
          {!lit && <Caption>You</Caption>}
        </div>
      ))}
    </div>
  );
}

/** One flame, lit for the first time. */
export function FirstScene() {
  return <Flame size={170} lit />;
}

/**
 * The headline's size, shrunk so its longest word fits the column. A username
 * can be 30 characters with no space to break at, and at full size it would
 * run off the card.
 */
function headlineSize(headline: string, full: number, column: number): number {
  const longest = Math.max(...headline.split(" ").map((word) => word.length));
  // Newsreader averages about half an em per character.
  return Math.min(full, Math.floor(column / (longest * 0.52)));
}

/**
 * One card for every link: a flat night ground, the mark, the words, and a
 * small picture in gold. The words and picture change with the link; nothing
 * else does, so every preview reads as the same product. Without a scene the
 * card is words only (the legal pages).
 */
export function OgCard({
  headline,
  subhead,
  scene,
}: {
  headline: string;
  subhead: string;
  scene?: ReactNode;
}) {
  const column = scene ? 620 : 1040;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: GROUND,
        fontFamily: "Figtree",
        color: INK,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
          padding: "64px 0 64px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <LampMark size={60} />
          <div style={{ fontFamily: "Newsreader", fontSize: 34, fontWeight: 500 }}>MotiveFaith</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: column }}>
          <div
            style={{
              fontFamily: "Newsreader",
              fontSize: headlineSize(headline, scene ? 76 : 92, column),
              fontWeight: 500,
              letterSpacing: -1.5,
              lineHeight: 1.05,
              textWrap: "balance",
            }}
          >
            {headline}
          </div>
          <div
            style={{
              fontSize: 30,
              color: SUB,
              marginTop: 22,
              lineHeight: 1.35,
              textWrap: "balance",
              maxWidth: scene ? 560 : 800,
            }}
          >
            {subhead}
          </div>
        </div>
      </div>

      {scene && (
        <div
          style={{
            display: "flex",
            width: 440,
            alignItems: "center",
            justifyContent: "center",
            paddingRight: 72,
          }}
        >
          {scene}
        </div>
      )}
    </div>
  );
}
