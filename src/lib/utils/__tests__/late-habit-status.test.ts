import { describe, expect, it } from "vitest";
import { lateHabitStatus } from "../late-habit-status";
import type { LateHabit } from "@/lib/types/late-habits";

// Saturday 7 November 2026, 6 PM on this machine's clock.
const NOW = new Date(2026, 10, 7, 18, 0);

function habit(overrides: Partial<LateHabit>): LateHabit {
  return {
    habitId: "h",
    title: "Run",
    emoji: "🏃",
    color: "#EF4444",
    ownerId: "o",
    ownerName: "Olive",
    ownerAvatar: null,
    kind: "remind",
    day: "2026-11-07",
    closedAt: new Date(2026, 10, 7, 10, 0).toISOString(),
    ...overrides,
  };
}

describe("lateHabitStatus", () => {
  it("says when a window ended, the app's way, while it can still be logged", () => {
    expect(lateHabitStatus(habit({}), NOW)).toBe("Not logged yet · ended 10 AM");
    expect(
      lateHabitStatus(habit({ closedAt: new Date(2026, 10, 7, 9, 30).toISOString() }), NOW),
    ).toBe("Not logged yet · ended 9:30 AM");
  });

  it("names the day when a friend's window ended on the viewer's yesterday", () => {
    expect(
      lateHabitStatus(habit({ closedAt: new Date(2026, 10, 6, 23, 0).toISOString() }), NOW),
    ).toBe("Not logged yet · ended yesterday at 11 PM");
  });

  it("says which day was missed, as the viewer counts days", () => {
    expect(lateHabitStatus(habit({ kind: "encourage", day: "2026-11-06" }), NOW)).toBe(
      "Missed yesterday",
    );
    // A friend ahead of the viewer: their missed day is the viewer's today.
    expect(lateHabitStatus(habit({ kind: "encourage", day: "2026-11-07" }), NOW)).toBe(
      "Missed today",
    );
    expect(lateHabitStatus(habit({ kind: "encourage", day: "2026-11-05" }), NOW)).toBe(
      "Missed on Thursday",
    );
  });
});
