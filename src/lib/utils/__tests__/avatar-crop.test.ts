import { describe, it, expect } from "vitest";
import { clampOffset, cropRect, displayScale, zoomAbout } from "../avatar-crop";

// A landscape photo, twice as wide as tall, in a 300px frame.
const image = { width: 2000, height: 1000 };
const frame = 300;

describe("avatar crop geometry", () => {
  it("covers the frame along the photo's shorter side at zoom 1", () => {
    expect(displayScale(image, frame, 1)).toBeCloseTo(0.3);
    // Centred: the middle 1000×1000 square.
    expect(cropRect({ x: 0, y: 0 }, image, frame, 1)).toEqual({ x: 500, y: 0, size: 1000 });
  });

  it("never lets an edge of the frame show past the photo", () => {
    // Shown 600×300: 150px to spare either side, none up or down.
    expect(clampOffset({ x: 999, y: 50 }, image, frame, 1)).toEqual({ x: 150, y: 0 });
    expect(clampOffset({ x: -999, y: -50 }, image, frame, 1)).toEqual({ x: -150, y: 0 });
    // Dragged fully right, the crop starts at the photo's left edge.
    expect(cropRect({ x: 150, y: 0 }, image, frame, 1).x).toBeCloseTo(0);
  });

  it("zooms in on the middle by default", () => {
    const rect = cropRect({ x: 0, y: 0 }, image, frame, 2);
    expect(rect.size).toBeCloseTo(500);
    expect(rect.x).toBeCloseTo(750);
    expect(rect.y).toBeCloseTo(250);
  });

  it("keeps the point under the fingers in place while zooming", () => {
    // Pinch over a point 60px right and 30px down of the centre.
    const anchor = { x: 60, y: 30 };
    const before = cropRect({ x: 0, y: 0 }, image, frame, 1);
    const offset = zoomAbout({ x: 0, y: 0 }, anchor, 1, 2, image, frame);
    const after = cropRect(offset, image, frame, 2);

    const photoPoint = (r: typeof before) => ({
      x: r.x + ((frame / 2 + anchor.x) / frame) * r.size,
      y: r.y + ((frame / 2 + anchor.y) / frame) * r.size,
    });
    expect(photoPoint(after).x).toBeCloseTo(photoPoint(before).x);
    expect(photoPoint(after).y).toBeCloseTo(photoPoint(before).y);
  });

  it("pulls the photo back over the frame when zooming out leaves a gap", () => {
    const zoomedIn = clampOffset({ x: 400, y: 200 }, image, frame, 3);
    const back = zoomAbout(zoomedIn, { x: 0, y: 0 }, 3, 1, image, frame);
    expect(back).toEqual(clampOffset(back, image, frame, 1));
    expect(back.y).toBe(0);
  });
});
