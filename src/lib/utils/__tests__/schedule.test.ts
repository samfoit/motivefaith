import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { movableDayKeys } from "../schedule";

// Wednesday 18 June 2025, noon UTC.
const WEDNESDAY = new Date("2025-06-18T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(WEDNESDAY);
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * A rain check may only be moved onto a day the habit is free. A day it is
 * already scheduled for has its own occurrence, so moving there would
 * double-book it and let work that was happening anyway settle the skip.
 */
describe("movableDayKeys", () => {
  it("skips the days the habit is already scheduled for", () => {
    // Mon/Wed/Fri: Fri 20, Mon 23 and Wed 25 are spoken for.
    expect(movableDayKeys({ schedule: { days: [1, 3, 5] } }, "UTC", 7)).toEqual([
      "2025-06-19", // Thu
      "2025-06-21", // Sat
      "2025-06-22", // Sun
      "2025-06-24", // Tue
    ]);
  });

  it("offers nothing for a habit scheduled every day", () => {
    expect(
      movableDayKeys({ schedule: { days: [0, 1, 2, 3, 4, 5, 6] } }, "UTC", 7),
    ).toEqual([]);
  });

  it("treats a missing or empty schedule as daily", () => {
    expect(movableDayKeys({ schedule: null }, "UTC", 7)).toEqual([]);
    expect(movableDayKeys({ schedule: { days: [] } }, "UTC", 7)).toEqual([]);
  });

  it("offers every other day for a once-a-week habit", () => {
    // Wednesdays only — free every day but next Wednesday.
    expect(movableDayKeys({ schedule: { days: [3] } }, "UTC", 7)).toEqual([
      "2025-06-19",
      "2025-06-20",
      "2025-06-21",
      "2025-06-22",
      "2025-06-23",
      "2025-06-24",
    ]);
  });

  it("never offers today, however far the window reaches", () => {
    const keys = movableDayKeys({ schedule: { days: [3] } }, "UTC", 14);
    expect(keys).not.toContain("2025-06-18");
    expect(keys[0]).toBe("2025-06-19");
  });

  it("reads the weekday in the habit owner's timezone", () => {
    // 18 June 23:30 UTC is already Thursday the 19th in Auckland, so a
    // Thursday-only habit has no free Thursday until the week is out.
    vi.setSystemTime(new Date("2025-06-18T23:30:00Z"));
    const keys = movableDayKeys(
      { schedule: { days: [4] } },
      "Pacific/Auckland",
      7,
    );
    expect(keys[0]).toBe("2025-06-20");
    expect(keys).not.toContain("2025-06-26");
  });
});
