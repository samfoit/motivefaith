import { describe, it, expect } from "vitest";
import { weekRateCounts } from "../useWeeklySummary";

const at = (day: number, hour = 12) => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;

describe("weekRateCounts", () => {
  it("counts each scheduled day of a daily kind, and each day done once", () => {
    const counts = weekRateCounts(
      [
        { id: "run", frequency: "daily", schedule: { days: [0, 1, 2, 3, 4, 5, 6] } },
        { id: "read", frequency: "specific_days", schedule: { days: [1, 3, 5] } },
      ],
      [
        { habit_id: "run", completed_at: at(12, 8) },
        { habit_id: "run", completed_at: at(12, 20) },
        { habit_id: "read", completed_at: at(14) },
      ],
      "UTC",
    );
    expect(counts).toEqual({ totalScheduled: 10, habitDaysDone: 2 });
  });

  it("counts a weekly habit as one due, done once however often", () => {
    const counts = weekRateCounts(
      [{ id: "call", frequency: "weekly", schedule: { days: [0, 1, 2, 3, 4, 5, 6] } }],
      [
        { habit_id: "call", completed_at: at(12) },
        { habit_id: "call", completed_at: at(15) },
      ],
      "UTC",
    );
    expect(counts).toEqual({ totalScheduled: 1, habitDaysDone: 1 });
  });
});
