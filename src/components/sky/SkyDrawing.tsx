import type React from "react";
import { sky, BAND_W, BAND_H, HORIZON } from "@/lib/lamplight/sky";

/**
 * The Lamplight sky as plain drawings: the horizon band (sun, moon, stars,
 * clouds, birds, hills and still water) and the tiled star field above it.
 *
 * No hooks and no client state, so a server component can draw a given hour
 * (the landing page's five hours) and a client one can draw the live hour
 * (SkyScene). Colors come from the `--sky-*` custom properties in scope, so
 * wrapping a drawing in an element that sets palette(hour).vars paints it in
 * that hour's colors whatever the page around it is showing.
 *
 * `idPrefix` keeps each drawing's gradient and pattern ids unique when more
 * than one is on a page; SVG ids are document-global.
 */

// Stars above the band, tiled. Positions from a seeded scatter on the design
// canvas, so the sky is the same every night.
const FIELD_STARS: [number, number, number, number][] = [
  [280.8, 404.9, 0.8, 0.8], [313.5, 218.9, 0.83, 0.77], [269.1, 98.5, 1.06, 0.63],
  [353.3, 504.6, 1.03, 0.7], [321.1, 276.6, 0.66, 0.53], [168.2, 252.7, 1.25, 0.68],
  [217.7, 389.6, 0.87, 0.47], [348, 99.1, 0.82, 0.56], [132.4, 404.3, 1.01, 0.49],
  [347, 357, 1.2, 0.73], [359.4, 317.9, 1.08, 0.5], [227.5, 288.4, 0.8, 0.58],
  [37.1, 324.4, 0.67, 0.4], [380.6, 204.8, 1.02, 0.44], [179, 443.5, 0.65, 0.9],
  [36.4, 65, 1.01, 0.49], [285.2, 377.2, 1.07, 0.49], [337.9, 214.5, 0.83, 0.89],
  [52.3, 377.1, 0.55, 0.9], [107.6, 206.6, 0.71, 0.69], [194.3, 84.9, 0.63, 0.9],
  [56.9, 504.2, 1.22, 0.37], [294.1, 332.5, 0.74, 0.79], [339.7, 421.6, 0.81, 0.72],
  [282.8, 278.4, 1.09, 0.6], [82.3, 263.5, 1.29, 0.95], [249.3, 150.6, 0.92, 0.68],
];
const FIELD_W = 390;
const FIELD_H = 560;

// Stars low in the band, a few of which breathe.
const BAND_STARS: [number, number, number, number, string?][] = [
  [8, 101.3, 0.77, 0.48, "sky-twinkle"], [353, 28.7, 0.64, 0.66], [280.7, 73.8, 0.59, 0.51],
  [305.2, 100.6, 0.63, 0.84], [372.8, 82, 1.21, 0.89, "sky-twinkle"],
  [246.2, 112.2, 0.57, 0.89, "sky-twinkle sky-twinkle-slow"], [78.4, 132, 0.97, 0.76],
  [27.6, 44.4, 1.08, 0.78], [338.3, 43.3, 1.29, 0.92, "sky-twinkle"],
  [164.5, 126.2, 0.84, 0.47, "sky-twinkle sky-twinkle-slow"],
];

const SPARKLE = "M0 -7C.8 -1.2 1.2 -.8 7 0C1.2 .8 .8 1.2 0 7C-.8 1.2 -1.2 .8 -7 0C-1.2 -.8 -.8 -1.2 0 -7Z";
const CLOUD = "M10 24H78A10 10 0 0 0 76 4A14 14 0 0 0 50 -4A12 12 0 0 0 28 2A11 11 0 0 0 10 24Z";
const BIRD = "M0 0Q4 -4 8 0Q12 -4 16 0";
// Hills and water run well past the drawing's 390px on both sides, so a wide
// screen sees more landscape rather than a stretched one.
const FAR_HILLS =
  "M-1200 174V150C-900 140-600 136-400 142C-200 148-60 136 0 148C60 136 110 132 170 142C230 152 280 128 340 132C365 134 380 138 390 140C500 150 700 130 900 138C1100 146 1400 136 1600 142V174Z";
const NEAR_HILL = "M-1200 174V160C-700 150-300 154 0 156C40 147 92 149 132 160C150 165 166 170 178 174Z";

const fill = (v: string) => ({ fill: `var(${v})` });
const stroke = (v: string) => ({ stroke: `var(${v})` });

interface DrawingProps {
  hour: number;
  idPrefix: string;
  className?: string;
  style?: React.CSSProperties;
}

/** The tiled star field, at native size so stars stay pin-points on any width. */
export function SkyStarField({ hour, idPrefix, className, style }: DrawingProps) {
  return (
    <svg aria-hidden="true" className={className} style={{ ...style, opacity: sky(hour).stars }}>
      <defs>
        <pattern id={`${idPrefix}-stars`} width={FIELD_W} height={FIELD_H} patternUnits="userSpaceOnUse">
          <g style={fill("--sky-star")}>
            {FIELD_STARS.map(([cx, cy, r, op]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} opacity={op} />
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${idPrefix}-stars)`} />
    </svg>
  );
}

/**
 * The horizon band, 390×220 with the horizon at y = 172. Anchored to the
 * bottom and drawn past its own box (`overflow: visible`), so the hills and
 * water fill any width; clip it with the container where that is not wanted.
 */
export function SkyBand({ hour, idPrefix, className, style }: DrawingProps) {
  const s = sky(hour);
  const glow = `${idPrefix}-glow`;

  return (
    <svg
      aria-hidden="true"
      className={className}
      style={{ overflow: "visible", ...style }}
      viewBox={`0 0 ${BAND_W} ${BAND_H}`}
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: "var(--sky-glow)", stopOpacity: 1 }} />
          <stop offset="1" style={{ stopColor: "var(--sky-glow)", stopOpacity: 0 }} />
        </radialGradient>
      </defs>

      <ellipse cx={s.glowX} cy={HORIZON} rx={260} ry={120} fill={`url(#${glow})`} opacity={s.glowOp} />

      <g style={fill("--sky-star")} opacity={s.stars}>
        {BAND_STARS.map(([cx, cy, r, op, cls]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} opacity={op} className={cls} />
        ))}
        {/* "Canst thou bind the sweet influences of Pleiades, or loose
            the bands of Orion?" (Job 38:31) */}
        <g transform="translate(214 52)">
          <circle cx={0} cy={0} r={1.15} /><circle cx={6} cy={-3} r={1} /><circle cx={11} cy={1} r={1.2} />
          <circle cx={8} cy={6} r={0.9} /><circle cx={2.5} cy={5.5} r={0.85} /><circle cx={15} cy={-4} r={0.8} />
          <circle cx={-4} cy={4} r={0.75} />
        </g>
        <g transform="translate(104 84)">
          <circle cx={0} cy={0} r={1.25} /><circle cx={9} cy={-3.5} r={1.3} /><circle cx={18} cy={-7} r={1.25} />
          <circle cx={-6} cy={-24} r={1.35} opacity={0.8} /><circle cx={25} cy={-28} r={1.2} opacity={0.8} />
          <circle cx={-4} cy={22} r={1.1} opacity={0.7} /><circle cx={23} cy={17} r={1.4} opacity={0.8} />
        </g>
      </g>

      {/* The morning star before sunrise; the same light low in the west at evening. */}
      <path transform="translate(320 60)" d={SPARKLE} style={fill("--sky-star")} opacity={s.morningStar} />
      <path transform="translate(64 88) scale(.8)" d={SPARKLE} fill="#F4E7C8" opacity={s.eveningStar} />

      <g transform={`translate(${s.moonX} ${s.moonY})`} opacity={s.moonOp}>
        <circle r={30} style={fill("--sky-star")} opacity={0.06} />
        <path transform="rotate(-24)" d="M0 -13A13 13 0 1 0 0 13A9 13 0 1 1 0 -13Z" style={fill("--sky-star")} />
      </g>

      <g transform={`translate(${s.sunX} ${s.sunY})`} opacity={s.sunOp}>
        <circle r={s.sunHalo} style={fill("--sky-sun")} opacity={0.14} />
        <path
          d="M0 -26V-32M0 26V32M-26 0H-32M26 0H32M18.4 -18.4L22.6 -22.6M-18.4 -18.4L-22.6 -22.6M18.4 18.4L22.6 22.6M-18.4 18.4L-22.6 22.6"
          style={stroke("--sky-sun")}
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={s.rays}
        />
        <circle r={s.sunR} style={fill("--sky-sun")} />
      </g>

      <g style={{ ...fill("--sky-cloud"), ...stroke("--sky-cloud-line") }} strokeWidth={1.25} opacity={s.clouds}>
        <path transform={`translate(${s.cloud1} 52)`} d={CLOUD} />
        <path transform={`translate(${s.cloud2} 98) scale(.72)`} d={CLOUD} />
        <path transform={`translate(${s.cloud3} 34) scale(.5)`} d={CLOUD} />
      </g>

      {/* "Behold the fowls of the air" (Matthew 6:26) */}
      <g fill="none" style={stroke("--sky-line")} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" opacity={s.birds}>
        <path transform={`translate(${s.birdX} 76)`} d={BIRD} />
        <path transform={`translate(${s.birdX2} 88) scale(.7)`} d={BIRD} />
      </g>

      <path d={FAR_HILLS} style={fill("--sky-hill-far")} />
      <g style={fill("--sky-hill-near")}>
        {/* An olive tree on the far ridge */}
        <path d="M296 133V124" style={stroke("--sky-hill-near")} strokeWidth={1.6} strokeLinecap="round" />
        <ellipse cx={292.5} cy={121} rx={6} ry={3.8} />
        <ellipse cx={300} cy={119.5} rx={5.5} ry={3.6} />
        <ellipse cx={296} cy={115.5} rx={4.6} ry={3.2} />
        <path d={NEAR_HILL} />
      </g>

      {/* "He leadeth me beside the still waters" (Psalm 23:2) */}
      <rect x={-1200} y={HORIZON} width={2800} height={48} style={fill("--sky-water")} />
      <path
        d="M24 185H112M196 193H322M58 205H160M250 211H352M-180 190H-60M440 188H560M-120 206H-20M470 204H600"
        style={stroke("--sky-line")}
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.45}
      />
      <path
        transform={`translate(${s.sunX} 0)`}
        d="M-15 179H15M-10 187H10M-6 195H6M-3 203H3"
        style={stroke("--sky-sun")}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={s.sunGlint}
      />
      <path
        transform={`translate(${s.moonX} 0)`}
        d="M-9 180H9M-6 188H6M-3 196H3"
        style={stroke("--sky-star")}
        strokeWidth={1.2}
        strokeLinecap="round"
        opacity={s.moonGlint}
      />
    </svg>
  );
}
