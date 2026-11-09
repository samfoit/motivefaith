import { describe, it, expect } from "vitest";
import { isLight } from "../palette";
import {
  sky,
  HORIZON,
  BIRD_ROWS,
  CLOUD_ROWS,
  EVENING_STAR_AT,
  MORNING_STAR_AT,
  OLIVE_TREE_AT,
  ORION,
  PLEIADES,
  type Sky,
} from "../sky";
import { FAR_HILLS } from "@/components/sky/SkyDrawing";

type Box = { x0: number; x1: number; y0: number; y1: number };

/** Every 5 minutes of the day. */
const DAY = Array.from({ length: 288 }, (_, i) => i / 12);
/** Below this an element is as good as not drawn. */
const SHOWN = 0.05;

const clock = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/** The far ridge's height at x, read off the drawing's own path. */
const SEGMENTS: number[][] = (() => {
  const tokens = FAR_HILLS.match(/[A-Za-z]|-?\d*\.?\d+/g)!;
  const out: number[][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < tokens.length; ) {
    const cmd = tokens[i++];
    const n = () => Number(tokens[i++]);
    if (cmd === "M") [x, y] = [n(), n()];
    else if (cmd === "V") y = n();
    else if (cmd === "C") {
      const seg = [x, y, n(), n(), n(), n(), n(), n()];
      out.push(seg);
      [x, y] = [seg[6], seg[7]];
    }
  }
  return out;
})();

function ridgeAt(x: number): number {
  const seg = SEGMENTS.find((s) => s[0] <= x && x <= s[6])!;
  const at = (t: number, k: 0 | 1) =>
    (1 - t) ** 3 * seg[k] + 3 * (1 - t) ** 2 * t * seg[2 + k] + 3 * (1 - t) * t ** 2 * seg[4 + k] + t ** 3 * seg[6 + k];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid, 0) < x) lo = mid;
    else hi = mid;
  }
  return at(lo, 1);
}

// Bounds of the drawing's shapes, in the band's units (SkyDrawing.tsx).
const CLOUD = { x0: 4.8, x1: 87.1, y0: -10.8, y1: 24 }; // CLOUD at scale 1
const BIRD = { x0: 0, x1: 16, y0: -2, y1: 0 }; // BIRD at scale 1
const TREE: Box = { x0: OLIVE_TREE_AT[0] - 9.5, x1: OLIVE_TREE_AT[0] + 9.5, y0: OLIVE_TREE_AT[1] - 20.7, y1: OLIVE_TREE_AT[1] + 0.8 };
const MOON_HALO = 30;
const SPARKLE = 7;

function placed(b: typeof CLOUD, x: number, y: number, scale: number): Box {
  return { x0: x + b.x0 * scale, x1: x + b.x1 * scale, y0: y + b.y0 * scale, y1: y + b.y1 * scale };
}

function bounds({ at: [x, y], stars }: typeof ORION): Box {
  return {
    x0: x + Math.min(...stars.map(([cx, , r]) => cx - r)),
    x1: x + Math.max(...stars.map(([cx, , r]) => cx + r)),
    y0: y + Math.min(...stars.map(([, cy, r]) => cy - r)),
    y1: y + Math.max(...stars.map(([, cy, r]) => cy + r)),
  };
}

const CONSTELLATIONS = { Pleiades: bounds(PLEIADES), Orion: bounds(ORION) };

function apart(a: Box, b: Box, gap: number): boolean {
  return a.x1 + gap <= b.x0 || b.x1 + gap <= a.x0 || a.y1 + gap <= b.y0 || b.y1 + gap <= a.y0;
}

function clearOfCircle(b: Box, cx: number, cy: number, r: number): boolean {
  const dx = Math.max(b.x0 - cx, 0, cx - b.x1);
  const dy = Math.max(b.y0 - cy, 0, cy - b.y1);
  return dx * dx + dy * dy >= r * r;
}

/** The sun as drawn: its halo, or its rays where they reach further. */
const sunReach = (s: Sky) => Math.max(s.sunHalo, 32);

describe("sky", () => {
  it("never produces NaN through the day", () => {
    for (let h = 0; h < 24; h += 0.25) {
      for (const [key, value] of Object.entries(sky(h))) {
        expect(Number.isFinite(value), `${key} at ${h}`).toBe(true);
      }
    }
  });

  it("shows stars and the moon at night, not the sun", () => {
    const s = sky(22);
    expect(s.stars).toBe(1);
    expect(s.moonOp).toBeGreaterThan(0.5);
    expect(s.sunOp).toBe(0);
    expect(s.clouds).toBe(0);
  });

  it("shows the sun high and the clouds out at midday, not the moon or stars", () => {
    const s = sky(13);
    expect(s.sunOp).toBe(1);
    expect(s.sunY).toBeLessThan(HORIZON - 120);
    expect(s.moonOp).toBe(0);
    expect(s.stars).toBe(0);
    expect(s.clouds).toBe(1);
  });

  it("brings out the morning star before dawn and the evening star at nightfall", () => {
    expect(sky(5).morningStar).toBe(1);
    expect(sky(13).morningStar).toBe(0);
    expect(sky(20.25).eveningStar).toBe(1);
  });

  it("puts the sun on the far ridge at sunrise and dusk, and behind it by nightfall", () => {
    // The landing page's Sunrise and Dusk hours, and its sunrise photo.
    for (const h of [6.5, 19.5]) {
      const s = sky(h);
      const ridge = ridgeAt(s.sunX);
      expect(s.sunY - s.sunR, `some of the disc is up at ${clock(h)}`).toBeLessThan(ridge - 4);
      expect(s.sunY + s.sunR, `the disc still meets the ridge at ${clock(h)}`).toBeGreaterThan(ridge);
    }
    const set = sky(20);
    expect(set.sunOp === 0 || set.sunY - set.sunR >= ridgeAt(set.sunX)).toBe(true);
    expect(sky(6.5).glowOp).toBeGreaterThan(0.9);
  });

  it("never shows the sun's glint while the sun is behind the hills", () => {
    const glints = DAY.filter((h) => {
      const s = sky(h);
      return s.sunGlint > 0 && s.sunY - s.sunR >= ridgeAt(s.sunX);
    });
    expect(glints.map(clock)).toEqual([]);
  });

  it("keeps the moon and every star to the dark, where they can be seen", () => {
    const specks = DAY.filter(isLight).flatMap((h) => {
      const s = sky(h);
      return (["stars", "morningStar", "eveningStar", "moonOp"] as const)
        .filter((k) => s[k] > 0)
        .map((k) => `${k} at ${clock(h)}`);
    });
    expect(specks).toEqual([]);
  });

  it("keeps the sky's things off one another all day", () => {
    const hits = new Set<string>();
    const hit = (what: string, h: number) => hits.add(`${what} at ${clock(h)}`);

    for (const h of DAY) {
      const s = sky(h);
      const clouds = [s.cloud1, s.cloud2, s.cloud3].map((x, i) => placed(CLOUD, x, CLOUD_ROWS[i].y, CLOUD_ROWS[i].scale));
      const birds = [s.birdX, s.birdX2].map((x, i) => placed(BIRD, x, BIRD_ROWS[i].y, BIRD_ROWS[i].scale));
      const sunUp = s.sunOp > SHOWN;
      const moonUp = s.moonOp > SHOWN;

      clouds.forEach((c, i) => {
        if (s.clouds <= SHOWN) return;
        if (sunUp && !clearOfCircle(c, s.sunX, s.sunY, sunReach(s) + 4)) hit(`the sun behind cloud ${i + 1}`, h);
        if (!apart(c, TREE, 4)) hit(`cloud ${i + 1} on the olive tree`, h);
        clouds.slice(i + 1).forEach((d, j) => {
          if (!apart(c, d, 2)) hit(`clouds ${i + 1} and ${i + j + 2} stacked`, h);
        });
        birds.forEach((b, k) => {
          if (s.birds > SHOWN && !apart(b, c, 4)) hit(`bird ${k + 1} on cloud ${i + 1}`, h);
        });
      });
      birds.forEach((b, k) => {
        if (s.birds > SHOWN && sunUp && !clearOfCircle(b, s.sunX, s.sunY, s.sunHalo + 3)) hit(`bird ${k + 1} in the sun`, h);
      });
      if (sunUp && !clearOfCircle(TREE, s.sunX, s.sunY, sunReach(s) + 3)) hit("the sun on the olive tree", h);
      if (moonUp && !clearOfCircle(TREE, s.moonX, s.moonY, MOON_HALO)) hit("the moon in the olive tree", h);

      for (const [name, box] of Object.entries(CONSTELLATIONS)) {
        if (s.stars <= SHOWN) continue;
        if (moonUp && !clearOfCircle(box, s.moonX, s.moonY, MOON_HALO + 3)) hit(`the moon on ${name}`, h);
        if (!apart(box, TREE, 4)) hit(`${name} behind the olive tree`, h);
      }
      for (const [name, [x, y], op] of [
        ["morning star", MORNING_STAR_AT, s.morningStar],
        ["evening star", EVENING_STAR_AT, s.eveningStar],
      ] as const) {
        if (op > SHOWN && moonUp && Math.hypot(s.moonX - x, s.moonY - y) < MOON_HALO + SPARKLE) hit(`the moon on the ${name}`, h);
      }
    }
    expect([...hits]).toEqual([]);
  });
});
