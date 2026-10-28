import { describe, it, expect } from "vitest";
import { habitDayState, indexHabitDays, type DayState } from "../day-state";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";

/** Noon UTC on a day in October 2026. Thursday the 15th is today. */
const oct = (day: number) => `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`;
const TODAY = "2026-10-15";

function makeHabit(overrides: Partial<HabitWithCompletions> = {}): HabitWithCompletions {
  return {
    id: "habit-1",
    user_id: "user-1",
    title: "Read",
    description: null,
    emoji: "📚",
    color: null,
    frequency: "daily",
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
    time_window: null,
    visibility: "private" as const,
    streak_current: 0,
    streak_best: 0,
    total_completions: 0,
    is_paused: false,
    created_at: "2026-01-01T00:00:00Z",
    completions: [],
    ...overrides,
  } as HabitWithCompletions;
}

/** Each day from the 4th to the 17th as the views would mark it. */
function marks(habit: HabitWithCompletions): Record<number, DayState> {
  const index = indexHabitDays(habit, "UTC");
  const out: Record<number, DayState> = {};
  for (let day = 4; day <= 17; day++) {
    const key = `2026-10-${String(day).padStart(2, "0")}`;
    out[day] = habitDayState(habit, index, new Date(oct(day)), key, TODAY, "UTC");
  }
  return out;
}

const done = (...days: number[]) =>
  days.map((d, i) => ({ id: `c${i}`, completed_at: oct(d), completion_type: "quick" as const }));

describe("habitDayState", () => {
  describe("weekly", () => {
    // Weeks run Sunday to Saturday: the 4th to the 10th, and the 11th to the 17th.

    it("marks the day done and the rest of its week off", () => {
      const m = marks(makeHabit({ frequency: "weekly", completions: done(6) }));
      expect(m[6]).toBe("done");
      expect([m[4], m[5], m[7], m[8], m[9], m[10]]).toEqual(["off", "off", "off", "off", "off", "off"]);
    });

    it("misses a week that ended without it on its Saturday alone", () => {
      const m = marks(makeHabit({ frequency: "weekly", completions: done(13) }));
      expect(m[10]).toBe("missed");
      expect([m[4], m[5], m[6], m[7], m[8], m[9]]).toEqual(["off", "off", "off", "off", "off", "off"]);
    });

    it("leaves a week still running open: past days off, today open, the rest to come", () => {
      const m = marks(makeHabit({ frequency: "weekly", completions: done(6) }));
      expect([m[11], m[12], m[13], m[14]]).toEqual(["off", "off", "off", "off"]);
      expect(m[15]).toBe("today");
      expect([m[16], m[17]]).toEqual(["upcoming", "upcoming"]);
    });

    it("takes a week done today as done, today and after", () => {
      const m = marks(makeHabit({ frequency: "weekly", completions: done(15) }));
      expect(m[15]).toBe("done");
      expect([m[16], m[17]]).toEqual(["off", "off"]);
    });

    it("takes a rain-checked week as accounted for", () => {
      const m = marks(
        makeHabit({
          frequency: "weekly",
          completions: [{ id: "r1", completed_at: oct(7), completion_type: "rain_check" }],
        }),
      );
      expect(m[7]).toBe("rain");
      expect(m[10]).toBe("off");
    });

    it("keeps a paused Saturday off", () => {
      const m = marks(
        makeHabit({ frequency: "weekly", pauses: [{ started_on: "2026-10-09", ended_on: "2026-10-12" }] }),
      );
      expect(m[10]).toBe("off");
    });
  });

  describe("schedule changes", () => {
    it("judges each day by the schedule it had, and the day of a change by the new one", () => {
      // Mondays only until Tuesday the 13th, every day since.
      const m = marks(
        makeHabit({
          completions: done(5, 12, 13),
          schedule_changes: [{ changed_on: "2026-10-13", frequency: "specific_days", days: [1] }],
        }),
      );
      expect([m[5], m[6], m[11], m[12]]).toEqual(["done", "off", "off", "done"]);
      expect([m[13], m[14], m[15]]).toEqual(["done", "missed", "today"]);
    });

    it("shows a stretch kept weekly as weeks, and the days after as daily", () => {
      // Weekly until Monday the 12th, every day since.
      const m = marks(
        makeHabit({
          completions: done(6),
          schedule_changes: [{ changed_on: "2026-10-12", frequency: "weekly", days: [0, 1, 2, 3, 4, 5, 6] }],
        }),
      );
      expect([m[6], m[7], m[10], m[11]]).toEqual(["done", "off", "off", "off"]);
      expect([m[12], m[13], m[14]]).toEqual(["missed", "missed", "missed"]);
    });
  });
});
