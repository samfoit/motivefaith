import type { ColorKey, Rgb } from "./palette";

/** WCAG relative luminance. */
export function luminance(c: Rgb): number {
  const l = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}

export function ratio(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Text over a surface: held at 4.5:1. */
export const TEXT_PAIRS: [ColorKey, ColorKey][] = [
  ["ink", "card"], ["ink", "ground"], ["ink", "header"], ["ink", "tile"],
  ["sub", "card"], ["sub", "ground"], ["sub", "tile"],
  ["ring", "card"], ["ring", "ground"],
  ["navText", "nav"], ["accentText", "nav"], ["accentText", "card"], ["accentText", "ground"],
];

/** Icons and control outlines: held at 3:1. */
export const UI_PAIRS: [ColorKey, ColorKey][] = [
  ["sub", "header"], ["ring", "card"], ["flame", "card"],
];

export function lowest(raw: Record<ColorKey, Rgb>, pairs: [ColorKey, ColorKey][]): number {
  return pairs.reduce((m, [a, b]) => Math.min(m, ratio(raw[a], raw[b])), 99);
}
