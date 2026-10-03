import { describe, it, expect } from "vitest";
import { viewfinderCrop } from "../viewfinder-crop";

describe("viewfinderCrop", () => {
  it("trims top and bottom when a 4:3 camera fills a wide screen", () => {
    // 1920×1440 webcam in a 16:9 viewfinder: cover shows the full width and
    // a 1080-high band from the middle.
    expect(viewfinderCrop(1920, 1440, 16 / 9)).toEqual({
      sx: 0,
      sy: 180,
      sw: 1920,
      sh: 1080,
    });
  });

  it("trims the sides when a 4:3 sensor fills a tall phone screen", () => {
    // 1440×1080 frame in a 9:19.5 portrait viewfinder.
    const r = viewfinderCrop(1440, 1080, 9 / 19.5);
    expect(r.sh).toBe(1080);
    expect(r.sw).toBeCloseTo(1080 * (9 / 19.5));
    expect(r.sx).toBeCloseTo((1440 - r.sw) / 2);
    expect(r.sy).toBe(0);
  });

  it("crops around the centre for a digital zoom, after the trim", () => {
    expect(viewfinderCrop(1920, 1440, 16 / 9, 2)).toEqual({
      sx: 480,
      sy: 450,
      sw: 960,
      sh: 540,
    });
  });

  it("keeps the whole frame when the shapes already match", () => {
    expect(viewfinderCrop(1280, 720, 16 / 9)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it("keeps the whole frame before the viewfinder has a size", () => {
    expect(viewfinderCrop(640, 480, NaN)).toEqual({ sx: 0, sy: 0, sw: 640, sh: 480 });
  });
});
