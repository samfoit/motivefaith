import { describe, it, expect } from "vitest";
import { habitsLeftToday } from "../capture-habits";
import type { DashboardData } from "../dashboard";

type CachedHabit = DashboardData["habits"][number];

// Thursday 22 October 2026, 10:00 in Chicago.
const NOW = new Date("2026-10-22T15:00:00Z");
const THURSDAY = 4;

function habit(id: string, overrides: Partial<CachedHabit> = {}): CachedHabit {
  return {
    id,
    user_id: "me",
    title: id,
    description: null,
    emoji: null,
    color: null,
    frequency: "daily",
    schedule: null,
    time_window: null,
    streak_current: 3,
    streak_best: 3,
    total_completions: 3,
    is_paused: false,
    visibility: "private",
    private_checkins: false,
    created_at: "2026-09-01T00:00:00Z",
    completions: [],
    challenge: null,
    ...overrides,
  } as CachedHabit;
}

function dashboard(habits: CachedHabit[]): DashboardData {
  return { habits, timezone: "America/Chicago", firstName: "Sam" };
}

const ids = (habits: { id: string }[]) => habits.map((h) => h.id);

describe("habitsLeftToday", () => {
  it("lists the habits due today that have nothing logged today, in order", () => {
    const data = dashboard([
      habit("daily"),
      habit("thursdays", { schedule: { days: [THURSDAY] } }),
      habit("done", {
        completions: [{ id: "c1", completed_at: "2026-10-22T13:00:00Z", completion_type: "quick" }],
      }),
      habit("mwf", { schedule: { days: [1, 3, 5] } }),
    ]);

    expect(ids(habitsLeftToday(data, [], NOW))).toEqual(["daily", "thursdays"]);
  });

  it("leaves out a habit rain-checked today, as the server's list does", () => {
    const data = dashboard([
      habit("skipped", {
        completions: [
          { id: "c1", completed_at: "2026-10-22T14:00:00Z", completion_type: "rain_check" },
        ],
      }),
    ]);

    expect(habitsLeftToday(data, [], NOW)).toEqual([]);
  });

  it("reads today in the dashboard's timezone", () => {
    // 22:00 on Wednesday in Chicago, though it is already Thursday in UTC.
    const lastNight = "2026-10-22T03:00:00Z";
    const data = dashboard([
      habit("walk", {
        completions: [{ id: "c1", completed_at: lastNight, completion_type: "quick" }],
      }),
    ]);

    expect(ids(habitsLeftToday(data, [], NOW))).toEqual(["walk"]);
  });

  it("includes a makeup a rain check moved onto today", () => {
    const data = dashboard([
      habit("wednesdays", {
        schedule: { days: [3] },
        completions: [
          {
            id: "c1",
            completed_at: "2026-10-21T15:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2026-10-22",
          },
        ],
      }),
    ]);

    expect(ids(habitsLeftToday(data, [], NOW))).toEqual(["wednesdays"]);
  });

  it("draws each habit as the picker does, with reach from the server's last list", () => {
    const data = dashboard([
      habit("pray", { title: "Pray", emoji: "🙏", color: "#123456", private_checkins: true }),
      habit("new", { title: "New", streak_current: null }),
    ]);
    const lastFetched = [
      {
        id: "pray",
        title: "Pray",
        emoji: "🙏",
        color: "#123456",
        streak_current: 2,
        frequency: "daily" as const,
        partner_ids: ["f1"],
        group_ids: ["g1"],
      },
    ];

    expect(habitsLeftToday(data, lastFetched, NOW)).toEqual([
      {
        id: "pray",
        title: "Pray",
        emoji: "🙏",
        color: "#123456",
        streak_current: 3,
        frequency: "daily",
        partner_ids: ["f1"],
        group_ids: ["g1"],
        private_checkins: true,
      },
      {
        id: "new",
        title: "New",
        emoji: null,
        color: null,
        streak_current: 0,
        frequency: "daily",
        partner_ids: [],
        group_ids: [],
        private_checkins: false,
      },
    ]);
  });
});
