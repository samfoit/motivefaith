import { isLight } from "./palette";

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
 */

export const BAND_W = 390;
export const BAND_H = 220;
export const HORIZON = 172;

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
  const p = Math.max(0, Math.min(1, (hour - 6) / 14));
  const lift = Math.sin(p * Math.PI);
  const low = 1 - lift;
  const sunOp = ease(5.75, 6.4, hour) * (1 - ease(19.9, 20.4, hour));
  const night = hour < 12 ? 1 - ease(4.75, 6.25, hour) : ease(19.5, 20.75, hour);
  // The night runs past midnight: count its hours on from 20.
  const hx = hour < 12 ? hour + 24 : hour;
  const q = Math.max(0, Math.min(1, (hx - 20) / 10));
  const moonUp = hx >= 20 && hx <= 30 ? Math.sin(q * Math.PI) : 0;
  const moonOp = night * Math.min(1, moonUp * 4);
  const day = ease(7.5, 10, hour) * (1 - ease(16, 18.5, hour));
  const sunX = 30 + p * 330;

  return {
    stars: r2(night),
    morningStar: r2(ease(3.5, 4.5, hour) * (1 - ease(6.2, 7, hour))),
    eveningStar: r2(ease(18.6, 19.4, hour) * (1 - ease(20.6, 21.6, hour))),
    sunX: r1(sunX),
    sunY: r1(HORIZON + 12 - lift * 144),
    sunOp: r2(sunOp),
    sunR: r1(15 + 6 * low),
    sunHalo: r1(26 + 14 * low),
    rays: r2(0.25 + 0.4 * lift),
    sunGlint: r2(sunOp * Math.pow(low, 1.5) * 0.9),
    moonX: r1(40 + q * 310),
    moonY: r1(HORIZON - 8 - moonUp * 132),
    moonOp: r2(moonOp),
    moonGlint: r2(moonOp * 0.4),
    glowX: r1(hour < 12 ? 40 + Math.max(0, hour - 5) * 20 : sunX),
    glowOp: r2(Math.max(bump(hour, 6.5, 1.8), bump(hour, 19.4, 1.8), bump(hx, 29.4, 1.4) * 0.8)),
    clouds: isLight(hour) ? r2(0.3 + 0.7 * day) : 0,
    cloud1: r1(drift(60, 14, hour)),
    cloud2: r1(drift(300, 9, hour)),
    cloud3: r1(drift(180, 6, hour)),
    birds: r2(ease(6.75, 8.25, hour) * (1 - ease(17.5, 19, hour)) * 0.75),
    birdX: r1(drift(20, 22, hour)),
    birdX2: r1(drift(46, 22, hour)),
  };
}
