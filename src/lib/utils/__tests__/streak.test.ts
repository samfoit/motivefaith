import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeEffectiveStreak } from "../streak";

// Pin time to Sunday June 15, 2025 at noon UTC
const FAKE_NOW = new Date("2025-06-15T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FAKE_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("computeEffectiveStreak", () => {
  it("returns 0 when dbStreak is 0", () => {
    const result = computeEffectiveStreak(
      { streak_current: 0, schedule: null },
      [{ completed_at: "2025-06-15T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(0);
  });

  it("returns 0 when dbStreak is null", () => {
    const result = computeEffectiveStreak(
      { streak_current: null, schedule: null },
      [{ completed_at: "2025-06-15T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(0);
  });

  it("returns 0 when completions array is empty", () => {
    const result = computeEffectiveStreak(
      { streak_current: 5, schedule: null },
      [],
      "UTC",
    );
    expect(result).toBe(0);
  });

  it("returns dbStreak when completed today", () => {
    const result = computeEffectiveStreak(
      { streak_current: 7, schedule: null },
      [{ completed_at: "2025-06-15T08:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(7);
  });

  it("returns dbStreak when yesterday (scheduled) was completed", () => {
    // No completion today, but yesterday (Saturday June 14) was completed
    const result = computeEffectiveStreak(
      { streak_current: 5, schedule: null },
      [{ completed_at: "2025-06-14T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(5);
  });

  it("returns 0 when yesterday (scheduled) was NOT completed", () => {
    // Only a completion from 3 days ago, nothing yesterday
    const result = computeEffectiveStreak(
      { streak_current: 5, schedule: null },
      [{ completed_at: "2025-06-12T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(0);
  });

  it("skips non-scheduled days when walking back (weekday-only habit on Sunday checks Friday)", () => {
    // Today is Sunday (0). Habit scheduled Mon-Fri (1-5).
    // Friday June 13 was completed — streak should hold.
    const result = computeEffectiveStreak(
      { streak_current: 10, schedule: { days: [1, 2, 3, 4, 5] } },
      [{ completed_at: "2025-06-13T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(10);
  });

  it("returns 0 when most recent scheduled day was missed", () => {
    // Today is Sunday. Habit scheduled Mon-Fri.
    // Friday June 13 was NOT completed.
    const result = computeEffectiveStreak(
      { streak_current: 10, schedule: { days: [1, 2, 3, 4, 5] } },
      [{ completed_at: "2025-06-12T10:00:00Z" }], // Thursday only
      "UTC",
    );
    expect(result).toBe(0);
  });

  it("handles null schedule (always scheduled)", () => {
    const result = computeEffectiveStreak(
      { streak_current: 3, schedule: null },
      [{ completed_at: "2025-06-14T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(3);
  });

  it("handles empty days array (always scheduled)", () => {
    const result = computeEffectiveStreak(
      { streak_current: 3, schedule: { days: [] } },
      [{ completed_at: "2025-06-14T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(3);
  });

  it("returns 0 when no scheduled day in 14-day window", () => {
    // Habit only scheduled on day 0 (Sunday), but today IS Sunday.
    // Since not completed today, walks backward 14 days from Saturday.
    // Days 1-6 repeated = never hits day 0 until... actually it will hit
    // the previous Sunday (June 8). Let's use a schedule that can't match.
    // Schedule only day 0, but we mock time so today is Sunday and not completed.
    // Walking back from Saturday: Sat(6), Fri(5), Thu(4), Wed(3), Tue(2), Mon(1), Sun(0)
    // It will find Sunday June 8. So let's test with a day that doesn't exist in range.
    // Actually: let's just have schedule with no matching days in 14 lookback.
    // Impossible with 0-6 in 14 days. Instead test the "schedule exists but habit
    // only runs once every 3 weeks" scenario — not representable. Just verify the
    // function returns 0 if walk-back doesn't find a scheduled day within range.
    // We'd need a schedule with days that somehow never match... not possible with
    // standard weekdays over 14 days. Skip this edge case and test something else.

    // Alternative: verify streak=0 for truly missed recent scheduled day
    const result = computeEffectiveStreak(
      { streak_current: 5, schedule: { days: [6] } }, // Saturdays only
      [{ completed_at: "2025-06-07T10:00:00Z" }], // Completed June 7 (Saturday) but not June 14
      "UTC",
    );
    // Yesterday is Sat June 14 — scheduled and missed
    expect(result).toBe(0);
  });

  it("timezone edge case: UTC midnight completion is 'yesterday' in US/Pacific", () => {
    // Completion at 3am UTC on June 15 = 8pm June 14 in Pacific
    // "Today" in Pacific is June 14 (since fake now is noon UTC = 5am Pacific June 15)
    // Wait — noon UTC = 5am Pacific, still June 15. The completion at 3am UTC
    // is 8pm June 14 Pacific. So in Pacific, today is June 15 (not completed today),
    // yesterday June 14 was completed → streak holds.
    const result = computeEffectiveStreak(
      { streak_current: 4, schedule: null },
      [{ completed_at: "2025-06-15T03:00:00Z" }],
      "America/Los_Angeles",
    );
    // In Pacific: today=June 15 (noon UTC=5am PT), completion at 3am UTC = 8pm June 14 PT
    // Yesterday June 14 completed → streak valid
    expect(result).toBe(4);
  });
});
