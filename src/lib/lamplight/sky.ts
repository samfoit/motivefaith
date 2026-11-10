import { NIGHTFALL_AT, SUNRISE_AT, isLight } from "./palette";

/**
 * The sky behind the app, from the same hour as the palette.
 *
 * The sun and moon travel a low arc over the hills and are mirrored in still
 * water; the stars and the morning star fade with the dark; clouds and birds
 * belong to the day. Everything here is a number for SkyScene to place — no
 * colors, which come from the palette's `--sky-*` properties.
 *
 * Coordinates are in the horizon band's own space: 390 wide, 220 tall, the
 * horizon at y = 172. The star field is a separate, full-height layer whose
 * only input is `stars`.
 *
 * Nothing here should sit on anything else. The clouds, birds, stars and
 * constellations are placed so the sun and moon pass them by rather than
 * through them, and sky.test.ts walks the day to hold that. Two frames
 * matter most, because people pinned to Light or Dark see nothing else: the
 * clear midday (12:30) and the lamplit night (10 PM).
 */

export const BAND_W = 390;
export const BAND_H = 220;
export const HORIZON = 172;

/**
 * Where each drifting thing rides. Clouds and birds take their x from sky();
 * the drawing places them on these rows. One list for the drawing and the
 * test, so a cloud can't be moved in one and not the other.
 */
export const CLOUD_ROWS = [
  { y: 52, scale: 1 },
  { y: 94, scale: 0.72 },
  { y: 34, scale: 0.5 },
] as const;
export const BIRD_ROWS = [
  { y: 92, scale: 1 },
  { y: 104, scale: 0.7 },
] as const;

/**
 * The fixed lights. The sun rises on the left, so the left is east: the
 * morning star stands over the sunrise and the evening star low in the west
 * over the sunset. The Pleiades keep the upper left and Orion stands over
 * the valley, both off the moon's path.
 */
export const MORNING_STAR_AT = [58, 72] as const;
export const EVENING_STAR_AT = [330, 76] as const;

/** Each star is x, y, radius and opacity, around the constellation's anchor. */
type Star = readonly [number, number, number, number?];
interface Constellation {
  at: readonly [number, number];
  stars: readonly Star[];
}
export const PLEIADES: Constellation = {
  at: [34, 34],
  stars: [[0, 0, 1.15], [6, -3, 1], [11, 1, 1.2], [8, 6, 0.9], [2.5, 5.5, 0.85], [15, -4, 0.8], [-4, 4, 0.75]],
};
export const ORION: Constellation = {
  at: [200, 108],
  stars: [
    [0, 0, 1.25], [9, -3.5, 1.3], [18, -7, 1.25],
    [-6, -24, 1.35, 0.8], [25, -28, 1.2, 0.8], [-4, 22, 1.1, 0.7], [23, 17, 1.4, 0.8],
  ],
};

/**
 * The olive tree's foot on the far ridge. It stands on the slope, clear of
 * the sun's way down: on the crest at x = 296 the setting sun sat on top of
 * it like a lollipop, and the setting moon hung in its branches.
 */
export const OLIVE_TREE_AT = [250, 140] as const;

/**
 * The sun's arc runs from 4:48 AM to 9:12 PM and peaks at 1 PM. Timed that
 * way the disc meets the far ridge, not the horizon hidden behind it, at the
 * hours the palette names: its rim clears the hills just before 6, it is half
 * up at 6:30, half down at 7:15 PM, and gone by nightfall. Timed to the
 * horizon it stayed behind the hills for the first hour of sunrise and the
 * last of dusk.
 */
const SUN_FROM = 4.8;
const SUN_SPAN = 16.4;

function ease(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function bump(x: number, at: number, width: number): number {
  return Math.max(0, 1 - Math.abs(x - at) / width);
}

/** A slow drift across the band that wraps round, so clouds never pile up. */
function drift(start: number, speed: number, hour: number): number {
  return (((start + hour * speed) % 560) + 560) % 560 - 100;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Sky {
  stars: number;
  morningStar: number;
  eveningStar: number;
  sunX: number;
  sunY: number;
  sunOp: number;
  sunR: number;
  sunHalo: number;
  rays: number;
  sunGlint: number;
  moonX: number;
  moonY: number;
  moonOp: number;
  moonGlint: number;
  glowX: number;
  glowOp: number;
  clouds: number;
  cloud1: number;
  cloud2: number;
  cloud3: number;
  birds: number;
  birdX: number;
  birdX2: number;
}

export function sky(hour: number): Sky {
  const p = Math.max(0, Math.min(1, (hour - SUN_FROM) / SUN_SPAN));
  const lift = Math.sin(p * Math.PI);
  const low = 1 - lift;
  const sunOp = ease(5.75, 6.4, hour) * (1 - ease(19.6, NIGHTFALL_AT, hour));
  // The glint is the sun on still water, so there is none while the disc is
  // still behind the hills.
  const sunClear = ease(6, 6.75, hour) * (1 - ease(19, 19.75, hour));
  // Stars only in the dark family: on a light sky they read as specks of
  // dust. They are gone by the sunrise flip and come out after nightfall.
  const night = hour < 12 ? 1 - ease(4.75, SUNRISE_AT, hour) : ease(NIGHTFALL_AT, NIGHTFALL_AT + 1, hour);
  // The night runs past midnight: count its hours on from 20.
  const hx = hour < 12 ? hour + 24 : hour;
  const q = Math.max(0, Math.min(1, (hx - 20) / 10));
  const moonUp = hx >= 20 && hx <= 30 ? Math.sin(q * Math.PI) : 0;
  const moonOp = night * Math.min(1, moonUp * 4);
  const day = ease(7.5, 10, hour) * (1 - ease(16, 18.5, hour));
  const sunX = 30 + p * 330;

  return {
    stars: r2(night),
    // Gone before sunrise; the evening star is the first light of the night.
    morningStar: r2(ease(3.5, 4.5, hour) * (1 - ease(5.5, SUNRISE_AT, hour))),
    eveningStar: r2(hour >= NIGHTFALL_AT ? 1 - ease(20.75, 21.75, hour) : 0),
    sunX: r1(sunX),
    sunY: r1(HORIZON + 12 - lift * 144),
    sunOp: r2(sunOp),
    sunR: r1(15 + 6 * low),
    sunHalo: r1(26 + 14 * low),
    rays: r2(0.25 + 0.4 * lift),
    sunGlint: r2(sunOp * sunClear * Math.pow(low, 1.5) * 0.9),
    moonX: r1(40 + q * 310),
    moonY: r1(HORIZON - 8 - moonUp * 132),
    moonOp: r2(moonOp),
    moonGlint: r2(moonOp * 0.4),
    glowX: r1(hour < 12 ? 40 + Math.max(0, hour - 5) * 20 : sunX),
    glowOp: r2(Math.max(bump(hour, 6.5, 1.8), bump(hour, 19.4, 1.8), bump(hx, 29.4, 1.4) * 0.8)),
    clouds: isLight(hour) ? r2(0.3 + 0.7 * day) : 0,
    // Started so the sun passes between them, never behind one, and the
    // birds keep well clear of both.
    cloud1: r1(drift(224, 14, hour)),
    cloud2: r1(drift(532, 9, hour)),
    cloud3: r1(drift(89, 6, hour)),
    birds: r2(ease(6.75, 8.25, hour) * (1 - ease(17.5, 19, hour)) * 0.75),
    birdX: r1(drift(75, 22, hour)),
    birdX2: r1(drift(101, 22, hour)),
  };
}
