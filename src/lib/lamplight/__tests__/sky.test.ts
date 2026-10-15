import { describe, it, expect } from "vitest";
import { sky, HORIZON } from "../sky";

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

  it("raises the sun at the horizon at sunrise and sets it at dusk", () => {
    expect(sky(6.5).sunY).toBeGreaterThan(HORIZON - 20);
    expect(sky(19.5).sunY).toBeGreaterThan(HORIZON - 20);
    expect(sky(6.5).glowOp).toBeGreaterThan(0.9);
  });

  it("brings out the morning star before dawn and the evening star at dusk", () => {
    expect(sky(5).morningStar).toBe(1);
    expect(sky(13).morningStar).toBe(0);
    expect(sky(19.5).eveningStar).toBe(1);
  });
});
