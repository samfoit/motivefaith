import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeekView } from "../WeekView";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Local noon on a day in the week of Mon Oct 12 – Sun Oct 18, 2026. */
const oct = (day: number) => new Date(2026, 9, day, 12).toISOString();

function makeHabit(overrides: Partial<HabitWithCompletions> = {}): HabitWithCompletions {
  return {
    id: "habit-1",
    user_id: "user-1",
    title: "Morning Run",
    description: null,
    emoji: "🏃",
    color: "#EF4444",
    frequency: "daily",
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
    time_window: null,
    visibility: "private" as const,
    streak_current: 0,
    streak_best: 0,
    total_completions: 0,
    is_paused: false,
    created_at: "2025-01-01T00:00:00Z",
    completions: [],
    ...overrides,
  } as HabitWithCompletions;
}

describe("WeekView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 15)); // Wednesday afternoon
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not count a rain check as done", () => {
    render(
      <WeekView
        timezone={TZ}
        onHabitPress={vi.fn()}
        habits={[
          makeHabit({
            completions: [
              { id: "c1", completed_at: oct(12), completion_type: "quick" },
              { id: "c2", completed_at: oct(13), completion_type: "rain_check" },
            ],
          }),
        ]}
      />,
    );
    // Mon, Tue and today are due; only Monday was actually done.
    expect(
      screen.getByRole("button", { name: "Morning Run: done 1 of 3 days so far this week" }),
    ).toBeInTheDocument();
  });

  it("does not count unscheduled days as due", () => {
    render(
      <WeekView
        timezone={TZ}
        onHabitPress={vi.fn()}
        habits={[
          makeHabit({
            schedule: { days: [1, 5] }, // Mon, Fri
            completions: [{ id: "c1", completed_at: oct(12), completion_type: "quick" }],
          }),
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Morning Run: done 1 of 1 day so far this week" }),
    ).toBeInTheDocument();
  });

  it("does not count a paused day as due", () => {
    render(
      <WeekView
        timezone={TZ}
        onHabitPress={vi.fn()}
        habits={[
          makeHabit({
            completions: [{ id: "c1", completed_at: oct(12), completion_type: "quick" }],
            // Paused Tuesday, back today.
            pauses: [{ started_on: "2026-10-13", ended_on: "2026-10-14" }],
          }),
        ]}
      />,
    );
    // Monday and today are due; Tuesday was paused, not missed.
    expect(
      screen.getByRole("button", { name: "Morning Run: done 1 of 2 days so far this week" }),
    ).toBeInTheDocument();
  });

  it("does not count days before the habit existed", () => {
    render(
      <WeekView
        timezone={TZ}
        onHabitPress={vi.fn()}
        habits={[makeHabit({ created_at: oct(14) })]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Morning Run: done 0 of 1 day so far this week" }),
    ).toBeInTheDocument();
  });
});
