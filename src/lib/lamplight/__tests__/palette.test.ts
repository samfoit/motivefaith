import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { palette, isLight, PINNED_HOUR, ALL_VARS, rgb, CSS_VAR } from "../palette";
import { lowest, ratio, TEXT_PAIRS, UI_PAIRS } from "../contrast";

const EVERY_15_MIN = Array.from({ length: 96 }, (_, i) => i / 4);

describe("palette", () => {
  it.each(EVERY_15_MIN)("keeps text at 4.5:1 and controls at 3:1 at hour %s", (hour) => {
    const { raw } = palette(hour);
    expect(lowest(raw, TEXT_PAIRS)).toBeGreaterThanOrEqual(4.5);
    expect(lowest(raw, UI_PAIRS)).toBeGreaterThanOrEqual(3);
  });

  it("keeps dark ink on the gold accent", () => {
    expect(ratio(rgb("#1A1405"), rgb("#E9B44C"))).toBeGreaterThanOrEqual(4.5);
  });

  it("flips family exactly at sunrise and nightfall", () => {
    expect(isLight(6.24)).toBe(false);
    expect(isLight(6.25)).toBe(true);
    expect(isLight(19.99)).toBe(true);
    expect(isLight(20)).toBe(false);
    expect(palette(3).light).toBe(false);
    expect(palette(13).light).toBe(true);
  });

  it("writes every custom property it promises", () => {
    expect(Object.keys(palette(9).vars).sort()).toEqual([...ALL_VARS].sort());
  });

  // The static blocks in tokens.css are the Light/Dark pins and the no-JS
  // fallback. They are hand-written, so hold them to the palette.
  it.each([
    ["light", ":root", PINNED_HOUR.light],
    ["dark", '[data-theme="dark"]', PINNED_HOUR.dark],
  ] as const)("tokens.css %s block matches the pinned palette", (_name, selector, hour) => {
    const tokens = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");
    const start = tokens.indexOf(`${selector} {`);
    const block = tokens.slice(start, tokens.indexOf("}", start));
    const { raw } = palette(hour);
    for (const [key, cssVar] of Object.entries(CSS_VAR)) {
      const m = block.match(new RegExp(`${cssVar}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m, `${cssVar} in ${selector}`).not.toBeNull();
      expect(rgb(m![1]), cssVar).toEqual(raw[key as keyof typeof raw]);
    }
  });
});
