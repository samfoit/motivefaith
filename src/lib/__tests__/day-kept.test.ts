import { describe, it, expect, vi } from "vitest";
import { dayKeptSummary, dayProgress, keptBy } from "../day-kept";
import { applyCompletion } from "../data/dashboard-mutations";
import type { DashboardData } from "../data/dashboard";

type CachedHabit = DashboardData["habits"][number];

// Thursday 22 October 2026, 10:00 in Chicago.
const NOW = new Date("2026-10-22T15:00:00Z");
const TODAY = "2026-10-22T14:00:00Z";
const YESTERDAY = "2026-10-21T14:00:00Z";

function habit(id: string, overrides: Partial<CachedHabit> = {}): CachedHabit {
  return {
    id,
    title: id,
    frequency: "daily",
    schedule: null,
    streak_current: 0,
    created_at: "2026-09-01T00:00:00Z",
    completions: [],
    ...overrides,
  } as CachedHabit;
}

const done = (at = TODAY) => ({ id: `c-${at}`, completed_at: at, completion_type: "quick" as const });
const rain = (at = TODAY, movedTo: string | null = null) => ({
  id: `r-${at}`,
  completed_at: at,
  completion_type: "rain_check" as const,
  rain_check_moved_to: movedTo,
});

function dashboard(habits: CachedHabit[]): DashboardData {
  return { habits, timezone: "America/Chicago", firstName: "Sam" };
}

describe("dayProgress", () => {
  it("is kept when every habit on today is done", () => {
    const p = dayProgress(dashboard([habit("a", { completions: [done()] }), habit("b", { completions: [done()] })]), NOW);
    expect(p).toMatchObject({ done: 2, rainChecked: 0, kept: true });
  });

  it("is not kept while one is open", () => {
    const p = dayProgress(dashboard([habit("a", { completions: [done()] }), habit("b")]), NOW);
    expect(p.kept).toBe(false);
  });

  it("counts a rain check as settled, but not a day of nothing else", () => {
    expect(
      dayProgress(dashboard([habit("a", { completions: [done()] }), habit("b", { completions: [rain()] })]), NOW).kept,
    ).toBe(true);
    expect(dayProgress(dashboard([habit("a", { completions: [rain()] })]), NOW).kept).toBe(false);
  });

  it("lets a real check-in outrank a rain check the same day", () => {
    const p = dayProgress(dashboard([habit("a", { completions: [rain(), done()] })]), NOW);
    expect(p.habits[0].state).toBe("done");
  });

  it("leaves out habits not on today, and counts yesterday as nothing", () => {
    const p = dayProgress(
      dashboard([
        habit("a", { completions: [done()] }),
        // Mondays only.
        habit("mon", { frequency: "specific_days", schedule: { days: [1] } }),
        habit("b", { completions: [done(YESTERDAY)] }),
      ]),
      NOW,
    );
    expect(p.habits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(p.kept).toBe(false);
  });

  it("includes a habit moved onto today by an earlier rain check", () => {
    const moved = habit("mon", {
      frequency: "specific_days",
      schedule: { days: [1] },
      completions: [rain("2026-10-19T14:00:00Z", "2026-10-22")],
    });
    const p = dayProgress(dashboard([habit("a", { completions: [done()] }), moved]), NOW);
    expect(p.habits.map((h) => h.id)).toEqual(["a", "mon"]);
    expect(p.kept).toBe(false);
  });

  it("has nothing to keep without data or habits", () => {
    expect(dayProgress(undefined, NOW).kept).toBe(false);
    expect(dayProgress(dashboard([]), NOW).kept).toBe(false);
  });
});

describe("keptBy", () => {
  const twoOpen = () => dashboard([habit("a", { completions: [done()] }), habit("b")]);

  it("fires on the check-in that settles the last habit, lighting it last", () => {
    const before = dashboard([habit("b"), habit("a", { completions: [done()] })]);
    const after = { ...before, habits: [before.habits[0], before.habits[1]].map((h) => (h.id === "b" ? { ...h, completions: [done()] } : h)) };
    const kept = keptBy(before, after, NOW);
    expect(kept?.flames).toEqual([
      { id: "a", state: "done", fresh: false },
      { id: "b", state: "done", fresh: true },
    ]);
  });

  it("does not fire while something is still open", () => {
    const before = dashboard([habit("a"), habit("b")]);
    const after = { ...before, habits: [habit("a", { completions: [done()] }), habit("b")] };
    expect(keptBy(before, after, NOW)).toBeNull();
  });

  it("does not fire again on a day already kept", () => {
    const before = dashboard([habit("a", { completions: [done()] })]);
    const after = dashboard([habit("a", { completions: [done(), done("2026-10-22T14:30:00Z")] })]);
    expect(keptBy(before, after, NOW)).toBeNull();
  });

  it("fires when a rain-checked day gets its first real check-in", () => {
    const before = dashboard([habit("a", { completions: [rain()] })]);
    const after = dashboard([habit("a", { completions: [rain(), done()] })]);
    expect(keptBy(before, after, NOW)?.flames).toEqual([{ id: "a", state: "done", fresh: true }]);
  });

  it("works on the dashboard's own optimistic update", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const before = twoOpen();
      const after = applyCompletion(before, { habitId: "b", tempId: "t", type: "photo" });
      expect(keptBy(before, after)?.flames.at(-1)).toMatchObject({ id: "b", fresh: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dayKeptSummary", () => {
  it("says what the day came to", () => {
    expect(dayKeptSummary({ done: 1, rainChecked: 0 })).toBe("Your habit for today, done.");
    expect(dayKeptSummary({ done: 2, rainChecked: 0 })).toBe("Both habits, done.");
    expect(dayKeptSummary({ done: 5, rainChecked: 0 })).toBe("All 5 habits, done.");
    expect(dayKeptSummary({ done: 3, rainChecked: 1 })).toBe("3 done, 1 rain-checked.");
  });
});
