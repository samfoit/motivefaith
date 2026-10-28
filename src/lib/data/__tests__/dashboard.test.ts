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
        or: () => query,
        gt: () => query,
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

  describe("pauses", () => {
    /** Every day, a streak of `streak`, and the given check-ins and pauses. */
    function run(
      streak: number,
      completions: unknown[],
      pauses: { started_on: string; ended_on: string | null }[],
    ) {
      return fakeServerSupabase({
        profiles: { display_name: "Sam Foit", timezone: "America/Chicago" },
        habits: [
          {
            id: "run",
            user_id: USER,
            title: "Run",
            description: null,
            emoji: "🏃",
            color: null,
            frequency: "daily",
            schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
            time_window: null,
            streak_current: streak,
            streak_best: streak,
            total_completions: streak,
            is_paused: false,
            visibility: "private",
            private_checkins: false,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        completions,
        habit_pauses: pauses.map((p) => ({ habit_id: "run", ...p })),
        group_challenges: [],
        group_challenge_participants: [],
      });
    }

    const doneThursday = {
      id: "c1",
      habit_id: "run",
      completed_at: "2026-10-15T15:00:00Z",
      completion_type: "quick",
      rain_check_moved_to: null,
    };

    it("keeps a streak across a pause, and sends the pause on for the views", async () => {
      // Thursday the 22nd: done last Thursday, paused Friday, back today.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-22T17:00:00Z"));
      const pause = { started_on: "2026-10-16", ended_on: "2026-10-22" };

      const data = await fetchDashboard(run(6, [doneThursday], [pause]), USER);
      expect(data.habits[0].streak_current).toBe(6);
      expect(data.habits[0].pauses).toEqual([pause]);

      // The same week unpaused was six days missed.
      const unpaused = await fetchDashboard(run(6, [doneThursday], []), USER);
      expect(unpaused.habits[0].streak_current).toBe(0);
    });

    it("keeps the server's streak when a pause reaches back past the check-ins fetched", async () => {
      // Paused since August: whether July 31 was done is older than the
      // dashboard fetches, so it is left to the server's sweep.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-22T17:00:00Z"));

      const data = await fetchDashboard(
        run(9, [], [{ started_on: "2026-08-01", ended_on: "2026-10-22" }]),
        USER,
      );
      expect(data.habits[0].streak_current).toBe(9);
    });
  });

  describe("schedule changes", () => {
    it("judges the days before a change by the schedule they had, and sends the change on", async () => {
      // Wednesday the 21st. Mon/Wed/Fri until today, every day from today:
      // done Monday, and Tuesday was a day off when it passed.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-21T17:00:00Z"));
      const change = { changed_on: "2026-10-21", frequency: "specific_days", days: [1, 3, 5] };
      const supabase = (changes: unknown[]) =>
        fakeServerSupabase({
          profiles: { display_name: "Sam Foit", timezone: "America/Chicago" },
          habits: [
            {
              id: "run",
              user_id: USER,
              title: "Run",
              description: null,
              emoji: "🏃",
              color: null,
              frequency: "daily",
              schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
              time_window: null,
              streak_current: 5,
              streak_best: 5,
              total_completions: 5,
              is_paused: false,
              visibility: "private",
              private_checkins: false,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
          completions: [
            {
              id: "c1",
              habit_id: "run",
              completed_at: "2026-10-19T15:00:00Z",
              completion_type: "quick",
              rain_check_moved_to: null,
            },
          ],
          habit_schedule_changes: changes,
          group_challenges: [],
          group_challenge_participants: [],
        });

      const data = await fetchDashboard(supabase([{ habit_id: "run", ...change }]), USER);
      expect(data.habits[0].streak_current).toBe(5);
      expect(data.habits[0].schedule_changes).toEqual([change]);

      // Read by today's schedule, Tuesday was a day due and missed.
      const unchanged = await fetchDashboard(supabase([]), USER);
      expect(unchanged.habits[0].streak_current).toBe(0);
    });
  });
});
