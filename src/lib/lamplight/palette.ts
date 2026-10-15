/**
 * Lamplight: the app's colors follow the hour.
 *
 * A full 24-hour cycle in two families. Hue drifts with the hour; lightness
 * does not. The light family (sunrise, clear-sky day, blue-hour dusk) and the
 * dark family (lamplit night, blue before dawn) each keep their text and
 * surfaces in the same lightness band, so every blend inside a family stays
 * readable. Light and dark meet only at sunrise and nightfall, where the
 * whole screen crossfades once instead of drifting through grey.
 *
 * Contrast is held at every 15-minute step: text never under 4.5:1, controls
 * never under 3:1 (palette.test.ts walks the whole day to prove it).
 *
 * Ported from the "Lamplight, live through the day" board on the design
 * canvas. The init script in theme-init-script.ts runs this same math before
 * first paint, built from the stops exported here, so the two cannot drift.
 */

export const COLOR_KEYS = [
  // Surfaces and text
  "ground", "header", "card", "border", "track", "tile", "nav",
  "ink", "sub", "ring", "navText", "accentText", "flame",
  // The sky behind the screen
  "sun", "skyGlow", "hillFar", "hillNear", "water", "line", "cloud", "cloudLine", "star",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];
export type Stop = Record<ColorKey, string> & { glow: number };

const SUNRISE: Stop = {
  ground: "#F3F3F1", header: "#F8EBD3", card: "#FFFFFF", border: "#E8E3D8", track: "#E7E4DC", tile: "#F4F1EA", nav: "#FFFFFF",
  ink: "#1C2030", sub: "#575C6B", ring: "#696559", navText: "#646052", accentText: "#875C0C", flame: "#A87410",
  sun: "#E9A94C", skyGlow: "#F7D9A6", hillFar: "#E3DED1", hillNear: "#D6D0BF", water: "#ECE8DE", line: "#BFB49A", cloud: "#FBF6EC", cloudLine: "#DCCFB4", star: "#FFFFFF",
  glow: 0.12,
};
// Midday is clear sky, not blank white: a blue header the gold sits warm against.
const DAY: Stop = {
  ground: "#ECF2F7", header: "#D3E5F3", card: "#FFFFFF", border: "#D9E3EC", track: "#D8E2EB", tile: "#EAF1F7", nav: "#FFFFFF",
  ink: "#1C2030", sub: "#4D5A69", ring: "#5E6A7A", navText: "#56677B", accentText: "#875C0C", flame: "#A87410",
  sun: "#F0C75E", skyGlow: "#E3EEF7", hillFar: "#D5E1D7", hillNear: "#C4D5C8", water: "#DCE7EF", line: "#A9BCCD", cloud: "#FFFFFF", cloudLine: "#C6D5E2", star: "#FFFFFF",
  glow: 0.06,
};
// Dusk is the blue hour: the clear day sky deepening toward night. It stays in
// the light family (a pale periwinkle header with dark text), so nothing flips
// before nightfall.
const DUSK: Stop = {
  ground: "#E5E8F2", header: "#CBD2EC", card: "#F9FAFD", border: "#D8DDEA", track: "#D5DAE8", tile: "#EBEEF6", nav: "#F9FAFD",
  ink: "#1E2233", sub: "#4F586E", ring: "#5C6580", navText: "#56607A", accentText: "#875C0C", flame: "#A87410",
  sun: "#E08A5B", skyGlow: "#EEC7B4", hillFar: "#CACDDF", hillNear: "#B6BBD3", water: "#D6DAEA", line: "#9FA6C2", cloud: "#F2E4E2", cloudLine: "#CDBCC6", star: "#FFFFFF",
  glow: 0.3,
};
const NIGHT: Stop = {
  ground: "#12151F", header: "#12151F", card: "#1B1F2D", border: "#232838", track: "#232838", tile: "#232838", nav: "#12151F",
  ink: "#EDE6D6", sub: "#A9A190", ring: "#8A8FA4", navText: "#8F897A", accentText: "#E9B44C", flame: "#E9B44C",
  sun: "#EDE6D6", skyGlow: "#1E2333", hillFar: "#0D1018", hillNear: "#080A10", water: "#171B28", line: "#2E3449", cloud: "#1B1F2D", cloudLine: "#2A3045", star: "#EDE6D6",
  glow: 0.55,
};
const PREDAWN: Stop = {
  ground: "#1A2033", header: "#27304D", card: "#222A40", border: "#2E3754", track: "#2E3754", tile: "#2E3754", nav: "#1A2033",
  ink: "#E9E7F0", sub: "#A8ADC1", ring: "#9097B2", navText: "#9198B0", accentText: "#E9B44C", flame: "#E9B44C",
  sun: "#F2B872", skyGlow: "#4A4568", hillFar: "#141A2B", hillNear: "#0E121D", water: "#1F2639", line: "#3A4363", cloud: "#222A40", cloudLine: "#2E3754", star: "#E9E7F0",
  glow: 0.42,
};

/** Sunrise at 6:15, nightfall at 8 PM. */
export const SUNRISE_AT = 6.25;
export const NIGHTFALL_AT = 20;

/**
 * The dark family runs past midnight, so its hours are counted on from 20
 * (5 AM is 29). Each family holds a color between two of its stops.
 */
export const LIGHT_STOPS: [number, Stop][] = [[6.25, SUNRISE], [8.5, SUNRISE], [11, DAY], [15.5, DAY], [18, DUSK], [20, DUSK]];
export const DARK_STOPS: [number, Stop][] = [[20, NIGHT], [27.5, NIGHT], [29.25, PREDAWN], [30.25, PREDAWN]];

/** Where each palette color lands. Keys without a token are scene-only. */
export const CSS_VAR: Record<ColorKey, string> = {
  ground: "--color-bg-primary",
  tile: "--color-bg-secondary",
  card: "--color-bg-elevated",
  track: "--color-surface-hover",
  ink: "--color-text-primary",
  sub: "--color-text-secondary",
  ring: "--color-text-tertiary",
  header: "--color-header",
  nav: "--color-nav",
  navText: "--color-nav-text",
  border: "--color-border",
  accentText: "--color-brand-ink",
  flame: "--color-streak",
  sun: "--sky-sun",
  skyGlow: "--sky-glow",
  hillFar: "--sky-hill-far",
  hillNear: "--sky-hill-near",
  water: "--sky-water",
  line: "--sky-line",
  cloud: "--sky-cloud",
  cloudLine: "--sky-cloud-line",
  star: "--sky-star",
};

export const GLOW_VARS = ["--lamp-glow-bar", "--lamp-glow-done", "--lamp-glow-fab", "--lamp-halo"] as const;

/** Every custom property palette() writes, for clearing them again. */
export const ALL_VARS: string[] = [...COLOR_KEYS.map((k) => CSS_VAR[k]), ...GLOW_VARS];

export type Rgb = [number, number, number];

export function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Rgb;
}

function css(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function isLight(hour: number): boolean {
  return hour >= SUNRISE_AT && hour < NIGHTFALL_AT;
}

/** The current hour as a fraction, local time: 6:30 PM is 18.5. */
export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

export function glowVars(g: number): Record<(typeof GLOW_VARS)[number], string> {
  const gold = "rgba(233, 180, 76, ";
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    "--lamp-glow-bar": g > 0.01 ? `0 0 10px 1px ${gold}${r2(g)})` : "none",
    "--lamp-glow-done": g > 0.01 ? `0 0 18px ${gold}${r2(g * 0.85)})` : "none",
    "--lamp-glow-fab": g > 0.01 ? `0 0 22px ${gold}${r2(g * 0.65)})` : "0 2px 6px rgba(28, 32, 48, 0.18)",
    "--lamp-halo": `radial-gradient(circle, ${gold}${r2(0.14 + g * 0.45)}) 0%, ${gold}0) 70%)`,
  };
}

export interface Palette {
  /** True from sunrise to nightfall. */
  light: boolean;
  /** Each color as 0–255 channels, for contrast checks. */
  raw: Record<ColorKey, Rgb>;
  /** Custom property → value, ready for `style.setProperty`. */
  vars: Record<string, string>;
}

export function palette(hour: number): Palette {
  const light = isLight(hour);
  const stops = light ? LIGHT_STOPS : DARK_STOPS;
  const x = light || hour >= NIGHTFALL_AT ? hour : hour + 24;
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
  const [atA, a] = stops[i];
  const [atB, b] = stops[i + 1];
  const t = Math.max(0, Math.min(1, (x - atA) / (atB - atA || 1)));

  // Inside one family every color blends, text included: both ends share a
  // lightness band.
  const raw = {} as Record<ColorKey, Rgb>;
  const vars: Record<string, string> = {};
  for (const k of COLOR_KEYS) {
    raw[k] = mixRgb(rgb(a[k]), rgb(b[k]), t);
    vars[CSS_VAR[k]] = css(raw[k]);
  }
  Object.assign(vars, glowVars(a.glow + (b.glow - a.glow) * t));
  return { light, raw, vars };
}

/** The Light and Dark pins: a clear midday and a lamplit night. */
export const PINNED_HOUR = { light: 12.5, dark: 22 } as const;
