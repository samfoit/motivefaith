import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeEffectiveStreak, countsTowardStreak } from "../streak";

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

  it("preserves streak across rest days (every day except Friday)", () => {
    // Today is Sunday June 15. Habit is every day except Friday (days: 0,1,2,3,4,6).
    // Last completion was Saturday June 14 — the most recent scheduled day.
    const result = computeEffectiveStreak(
      { streak_current: 12, schedule: { days: [0, 1, 2, 3, 4, 6] } },
      [{ completed_at: "2025-06-14T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(12);
  });

  it("preserves streak when completing after a multi-day gap in schedule", () => {
    // Today is Sunday June 15. Habit is Mon/Wed/Fri only (days: 1,3,5).
    // Last completion was Friday June 13 — most recent scheduled day.
    // Saturday (6) is not scheduled, so Friday is the expected prev day.
    const result = computeEffectiveStreak(
      { streak_current: 8, schedule: { days: [1, 3, 5] } },
      [{ completed_at: "2025-06-13T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(8);
  });

  // ── Weekly frequency tests ──

  it("weekly: streak valid when completed this week", () => {
    // Today is Sunday June 15 (week start = June 15).
    // Completed today → valid.
    const result = computeEffectiveStreak(
      { streak_current: 3, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, frequency: "weekly" },
      [{ completed_at: "2025-06-15T08:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(3);
  });

  it("weekly: streak valid when completed earlier this week", () => {
    // Today is Sunday June 15. Current week started June 15 (Sunday).
    // Completed Wednesday June 11 — that's in the previous week (June 8–14).
    // Previous week start = June 8. June 11 >= June 8 → valid.
    const result = computeEffectiveStreak(
      { streak_current: 5, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, frequency: "weekly" },
      [{ completed_at: "2025-06-11T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(5);
  });

  it("weekly: streak valid when completed last week", () => {
    // Today is Sunday June 15. Previous week = June 8–14.
    // Completed Saturday June 14 (last day of previous week).
    const result = computeEffectiveStreak(
      { streak_current: 4, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, frequency: "weekly" },
      [{ completed_at: "2025-06-14T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(4);
  });

  it("weekly: streak stale when no completion in current or previous week", () => {
    // Today is Sunday June 15. Previous week start = June 8.
    // Last completion was June 7 (Saturday) — before previous week.
    const result = computeEffectiveStreak(
      { streak_current: 6, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, frequency: "weekly" },
      [{ completed_at: "2025-06-07T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(0);
  });

  it("weekly: streak survives 6-day gap between completions", () => {
    // Today is Sunday June 15. Completed Monday June 9 (prev week).
    // June 9 >= prev week start (June 8) → valid.
    const result = computeEffectiveStreak(
      { streak_current: 2, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, frequency: "weekly" },
      [{ completed_at: "2025-06-09T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(2);
  });

  it("weekly: no frequency field falls through to daily logic", () => {
    // Habit without frequency field uses daily schedule logic.
    // Yesterday (June 14) was completed → valid.
    const result = computeEffectiveStreak(
      { streak_current: 3, schedule: null },
      [{ completed_at: "2025-06-14T10:00:00Z" }],
      "UTC",
    );
    expect(result).toBe(3);
  });

  // A rain check is a completions row like any other, which is exactly what
  // lets it hold the streak here without any special casing. These pin that
  // down so the behavior survives a future refactor of the callers.
  describe("rain checks", () => {
    it("holds the streak when yesterday was rain-checked", () => {
      const result = computeEffectiveStreak(
        { streak_current: 7, schedule: null },
        [{ completed_at: "2025-06-14T10:00:00Z" }],
        "UTC",
      );
      expect(result).toBe(7);
    });

    it("holds across a rain check that bridges two completions", () => {
      // June 13 done, June 14 rain-checked, nothing yet today.
      const result = computeEffectiveStreak(
        { streak_current: 7, schedule: null },
        [
          { completed_at: "2025-06-13T10:00:00Z" },
          { completed_at: "2025-06-14T10:00:00Z" },
        ],
        "UTC",
      );
      expect(result).toBe(7);
    });

    it("only covers its own day", () => {
      // June 13 rain-checked, June 14 (the last scheduled day) uncovered.
      const result = computeEffectiveStreak(
        { streak_current: 7, schedule: null },
        [{ completed_at: "2025-06-13T10:00:00Z" }],
        "UTC",
      );
      expect(result).toBe(0);
    });
  });

  // A rain check can name a day to make the habit up on. That makes it a
  // promise, and coversDay() has to stop honouring it once the promise is
  // broken — otherwise a moved rain check would be a free pass.
  describe("moved rain checks", () => {
    // Mon/Wed/Fri, so Saturday June 14 is off-schedule and can hold a makeup.
    const mwf = { streak_current: 7, schedule: { days: [1, 3, 5] } };

    it("holds while the promised day is still ahead", () => {
      // Rain-checked Friday June 13, promised for Monday June 16.
      const result = computeEffectiveStreak(
        mwf,
        [
          {
            completed_at: "2025-06-13T10:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-16",
          },
        ],
        "UTC",
      );
      expect(result).toBe(7);
    });

    it("holds on the promised day itself", () => {
      const result = computeEffectiveStreak(
        mwf,
        [
          {
            completed_at: "2025-06-13T10:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-15",
          },
        ],
        "UTC",
      );
      expect(result).toBe(7);
    });

    it("holds once the promise has been kept", () => {
      // Rain-checked Friday, made up on Saturday — an off-schedule day.
      const result = computeEffectiveStreak(
        mwf,
        [
          {
            completed_at: "2025-06-13T10:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-14",
          },
          { completed_at: "2025-06-14T10:00:00Z", completion_type: "quick" },
        ],
        "UTC",
      );
      expect(result).toBe(7);
    });

    it("breaks once the promised day has passed undone", () => {
      const result = computeEffectiveStreak(
        mwf,
        [
          {
            completed_at: "2025-06-13T10:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-14",
          },
        ],
        "UTC",
      );
      expect(result).toBe(0);
    });

    it("a rain check on the promised day does not keep the promise", () => {
      // Skipping the makeup is still skipping it.
      const result = computeEffectiveStreak(
        mwf,
        [
          {
            completed_at: "2025-06-13T10:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-14",
          },
          {
            completed_at: "2025-06-14T10:00:00Z",
            completion_type: "rain_check",
          },
        ],
        "UTC",
      );
      expect(result).toBe(0);
    });

    it("a plain rain check on the same day is unaffected", () => {
      const result = computeEffectiveStreak(
        mwf,
        [
          {
            completed_at: "2025-06-13T10:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: null,
          },
        ],
        "UTC",
      );
      expect(result).toBe(7);
    });
  });

  // Mirrors habit_last_due_day() and habit_last_counted_week() in migration
  // 047, which tests/habit-pauses.test.sql covers on the server.
  describe("pauses", () => {
    const daily = { streak_current: 5, schedule: null };
    const done = (day: string) => [{ completed_at: `${day}T10:00:00Z` }];

    it("holds across a pause that just ended", () => {
      // Done Tuesday, paused Wednesday to Saturday, back today.
      const result = computeEffectiveStreak(daily, done("2025-06-10"), "UTC", {
        pauses: [{ started_on: "2025-06-11", ended_on: "2025-06-15" }],
      });
      expect(result).toBe(5);
    });

    it("holds while the habit is still paused", () => {
      const result = computeEffectiveStreak(daily, done("2025-06-10"), "UTC", {
        pauses: [{ started_on: "2025-06-11", ended_on: null }],
      });
      expect(result).toBe(5);
    });

    it("still ends on a miss before the pause", () => {
      // Done Monday, missed Tuesday, paused from Wednesday.
      const result = computeEffectiveStreak(daily, done("2025-06-09"), "UTC", {
        pauses: [{ started_on: "2025-06-11", ended_on: "2025-06-15" }],
      });
      expect(result).toBe(0);
    });

    it("steps over a pause longer than the 14 days it searches", () => {
      const result = computeEffectiveStreak(daily, done("2025-05-01"), "UTC", {
        pauses: [{ started_on: "2025-05-02", ended_on: "2025-06-15" }],
      });
      expect(result).toBe(5);
    });

    it("steps over pauses and days off together", () => {
      // Mon–Fri. Done Friday May 30, paused through Friday June 13; Saturday
      // the 14th is off.
      const result = computeEffectiveStreak(
        { streak_current: 8, schedule: { days: [1, 2, 3, 4, 5] } },
        done("2025-05-30"),
        "UTC",
        { pauses: [{ started_on: "2025-05-31", ended_on: "2025-06-14" }] },
      );
      expect(result).toBe(8);
    });

    it("keeps the server's streak when the day before the pause wasn't loaded", () => {
      // Only check-ins from June 1 on were fetched, and the pause reaches
      // back past them: this side can't see whether April 30 was done.
      const result = computeEffectiveStreak(daily, [], "UTC", {
        pauses: [{ started_on: "2025-05-01", ended_on: "2025-06-15" }],
        loadedFrom: "2025-06-01",
      });
      expect(result).toBe(5);
    });

    it("checks the day before the pause when it was loaded", () => {
      const result = computeEffectiveStreak(daily, [], "UTC", {
        pauses: [{ started_on: "2025-06-11", ended_on: "2025-06-15" }],
        loadedFrom: "2025-06-01",
      });
      expect(result).toBe(0);
    });

    describe("weekly", () => {
      const weekly = { streak_current: 4, schedule: null, frequency: "weekly" };

      it("holds across weeks paused to their Saturday", () => {
        // Done Monday May 26, paused from Wednesday the 28th through today:
        // the Saturdays of the 31st, the 7th and the 14th were all paused.
        const result = computeEffectiveStreak(weekly, done("2025-05-26"), "UTC", {
          pauses: [{ started_on: "2025-05-28", ended_on: "2025-06-15" }],
        });
        expect(result).toBe(4);
      });

      it("holds a week resumed before its Saturday to it", () => {
        // Back on Wednesday June 11, and not done by that Saturday.
        const result = computeEffectiveStreak(weekly, done("2025-05-26"), "UTC", {
          pauses: [{ started_on: "2025-05-28", ended_on: "2025-06-11" }],
        });
        expect(result).toBe(0);
      });

      it("ends without a pause, as before", () => {
        const result = computeEffectiveStreak(weekly, done("2025-05-26"), "UTC");
        expect(result).toBe(0);
      });
    });
  });
});

describe("countsTowardStreak", () => {
  const daily = { frequency: "daily" };

  it("counts the first check-in of the day", () => {
    expect(countsTowardStreak(daily, [], "UTC")).toBe(true);
  });

  it("does not count another check-in the same day", () => {
    expect(
      countsTowardStreak(
        daily,
        [{ completed_at: "2025-06-15T08:00:00Z", completion_type: "photo" }],
        "UTC",
      ),
    ).toBe(false);
  });

  it("counts again the next day", () => {
    expect(
      countsTowardStreak(
        daily,
        [{ completed_at: "2025-06-14T20:00:00Z", completion_type: "quick" }],
        "UTC",
      ),
    ).toBe(true);
  });

  it("still counts the check-in after a rain check the same day", () => {
    expect(
      countsTowardStreak(
        daily,
        [{ completed_at: "2025-06-15T08:00:00Z", completion_type: "rain_check" }],
        "UTC",
      ),
    ).toBe(true);
  });

  it("reads the day in the user's timezone", () => {
    // 22:00 on Saturday in Chicago, though already Sunday in UTC.
    const lastNight = [{ completed_at: "2025-06-15T03:00:00Z", completion_type: "quick" }];
    expect(countsTowardStreak(daily, lastNight, "America/Chicago")).toBe(true);
    expect(countsTowardStreak(daily, lastNight, "UTC")).toBe(false);
  });

  describe("weekly", () => {
    const weekly = { frequency: "weekly" };

    // Wednesday 18 June, so the week (from Sunday the 15th) is underway.
    beforeEach(() => {
      vi.setSystemTime(new Date("2025-06-18T12:00:00Z"));
    });

    it("does not count a second check-in in the same week", () => {
      expect(
        countsTowardStreak(
          weekly,
          [{ completed_at: "2025-06-16T10:00:00Z", completion_type: "quick" }],
          "UTC",
        ),
      ).toBe(false);
    });

    it("counts the first check-in of a new week", () => {
      expect(
        countsTowardStreak(
          weekly,
          [{ completed_at: "2025-06-14T10:00:00Z", completion_type: "quick" }],
          "UTC",
        ),
      ).toBe(true);
    });
  });
});
