import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DashboardData } from "@/lib/data/dashboard";
import {
  applyCompletion,
  applyHabitUpdate,
  removeHabit,
} from "@/lib/data/dashboard-mutations";

const habit = (id: string, color: string | null) =>
  ({ id, title: id, color, completions: [] }) as unknown as DashboardData["habits"][number];

const data = {
  habits: [habit("a", "#111111"), habit("b", "#222222")],
  firstName: "Sam",
} as unknown as DashboardData;

describe("applyHabitUpdate", () => {
  it("patches only the edited habit", () => {
    const next = applyHabitUpdate(data, "a", { color: "#ff0000" });
    expect(next?.habits[0].color).toBe("#ff0000");
    expect(next?.habits[1].color).toBe("#222222");
    expect(data.habits[0].color).toBe("#111111");
  });

  it("leaves an empty cache empty", () => {
    expect(applyHabitUpdate(undefined, "a", { color: "#ff0000" })).toBeUndefined();
  });

  describe("a new schedule", () => {
    // Noon on Wednesday 18 June 2025, UTC.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-06-18T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const scheduled = (changes?: unknown[]) =>
      ({
        habits: [
          {
            id: "a",
            frequency: "specific_days",
            schedule: { days: [1, 3, 5] },
            completions: [],
            ...(changes ? { schedule_changes: changes } : {}),
          },
        ],
        timezone: "UTC",
        firstName: "Sam",
      }) as unknown as DashboardData;

    it("is kept as a change from today, with the schedule it replaced", () => {
      const next = applyHabitUpdate(scheduled(), "a", {
        frequency: "daily",
        schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
      });
      expect(next?.habits[0].schedule_changes).toEqual([
        { changed_on: "2025-06-18", frequency: "specific_days", days: [1, 3, 5] },
      ]);
    });

    it("keeps the first change of the day when there is a second", () => {
      const first = { changed_on: "2025-06-18", frequency: "daily", days: [0, 1, 2, 3, 4, 5, 6] };
      const next = applyHabitUpdate(scheduled([first]), "a", { schedule: { days: [1] } });
      expect(next?.habits[0].schedule_changes).toEqual([first]);
    });

    it("is no change when the days are the same in another order", () => {
      const next = applyHabitUpdate(scheduled(), "a", {
        title: "Renamed",
        frequency: "specific_days",
        schedule: { days: [5, 3, 1] },
      });
      expect(next?.habits[0].schedule_changes).toBeUndefined();
    });
  });
});

describe("removeHabit", () => {
  it("drops the habit from the list", () => {
    expect(removeHabit(data, "a")?.habits.map((h) => h.id)).toEqual(["b"]);
  });
});

describe("applyCompletion", () => {
  type Completions = DashboardData["habits"][number]["completions"];

  const withStreak = (completions: Completions) =>
    ({
      habits: [{ id: "a", frequency: "daily", streak_current: 4, completions }],
      timezone: "UTC",
      firstName: "Sam",
    }) as unknown as DashboardData;

  // Noon on Wednesday 18 June 2025, UTC.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-18T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const earlierToday = (completion_type: Completions[number]["completion_type"]) => ({
    id: "c1",
    completed_at: "2025-06-18T08:00:00Z",
    completion_type,
  });

  const apply = (data: DashboardData, type: "quick" | "photo" | "rain_check") =>
    applyCompletion(data, { habitId: "a", tempId: "temp-1", type })!.habits[0];

  it("advances the streak on the day's first check-in", () => {
    const next = apply(withStreak([]), "quick");
    expect(next.streak_current).toBe(5);
    expect(next.completions).toHaveLength(1);
  });

  it("records another check-in the same day without advancing the streak", () => {
    const next = apply(withStreak([earlierToday("quick")]), "photo");
    expect(next.streak_current).toBe(4);
    expect(next.completions.map((c) => c.completion_type)).toEqual(["quick", "photo"]);
  });

  it("advances it for a real check-in after a rain check the same day", () => {
    expect(apply(withStreak([earlierToday("rain_check")]), "quick").streak_current).toBe(5);
  });

  it("never advances it for a rain check", () => {
    expect(apply(withStreak([]), "rain_check").streak_current).toBe(4);
  });
});
