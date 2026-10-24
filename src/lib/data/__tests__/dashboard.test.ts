import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchDashboard } from "../dashboard";

type ServerClient = Parameters<typeof fetchDashboard>[0];

/**
 * Stands in for the server Supabase client: every query on a table resolves
 * to that table's rows, whatever it was filtered by.
 */
function fakeServerSupabase(tables: Record<string, unknown>): ServerClient {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        gte: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: rows, error: null }),
        then: (
          resolve: (value: { data: unknown; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return query;
    },
  } as unknown as ServerClient;
}

const USER = "me";

/** Mon/Wed/Fri, rain-checked on Wednesday 21 October and moved to Thursday. */
function sketchMovedToThursday() {
  return fakeServerSupabase({
    profiles: { display_name: "Sam Foit", timezone: "America/Chicago" },
    habits: [
      {
        id: "sketch",
        user_id: USER,
        title: "Sketch",
        description: null,
        emoji: "✏️",
        color: null,
        frequency: "daily",
        schedule: { days: [1, 3, 5] },
        time_window: null,
        streak_current: 3,
        streak_best: 3,
        total_completions: 9,
        is_paused: false,
        visibility: "private",
        private_checkins: false,
        created_at: "2026-09-01T00:00:00Z",
      },
    ],
    completions: [
      {
        id: "rc1",
        habit_id: "sketch",
        completed_at: "2026-10-21T15:00:00Z",
        completion_type: "rain_check",
        rain_check_moved_to: "2026-10-22",
      },
    ],
    group_challenges: [],
    group_challenge_participants: [],
  });
}

describe("fetchDashboard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the day a rain check was moved to, so the makeup can show there", async () => {
    // Thursday, noon in Chicago: the day the promise is for.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T17:00:00Z"));

    const data = await fetchDashboard(sketchMovedToThursday(), USER);

    expect(data.habits[0].completions).toEqual([
      {
        id: "rc1",
        completed_at: "2026-10-21T15:00:00Z",
        completion_type: "rain_check",
        rain_check_moved_to: "2026-10-22",
      },
    ]);
    // Pending, so Wednesday still counts.
    expect(data.habits[0].streak_current).toBe(3);
  });

  it("ends the streak once the day a rain check was moved to passes undone", async () => {
    // Friday: Thursday came and went with no check-in, so Wednesday's skip
    // no longer covers it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T17:00:00Z"));

    const data = await fetchDashboard(sketchMovedToThursday(), USER);

    expect(data.habits[0].streak_current).toBe(0);
  });
});
