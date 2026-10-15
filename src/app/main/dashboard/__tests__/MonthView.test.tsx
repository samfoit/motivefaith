import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthView } from "../MonthView";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
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

describe("MonthView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 15)); // Wed Oct 14
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("labels each day with how much of it was done, not counting rain checks", () => {
    render(
      <MonthView
        timezone={TZ}
        onHabitPress={vi.fn()}
        habits={[
          makeHabit({
            id: "a",
            completions: [
              { id: "c1", completed_at: oct(5), completion_type: "quick" },
              { id: "c2", completed_at: oct(6), completion_type: "rain_check" },
            ],
          }),
          makeHabit({
            id: "b",
            title: "Read",
            completions: [{ id: "c3", completed_at: oct(5), completion_type: "quick" }],
          }),
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "October 5: 2 of 2 done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "October 6: 0 of 2 done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "October 20: 2 scheduled" })).toBeInTheDocument();
  });

  it("says nothing is due on days a habit is not scheduled", () => {
    render(
      <MonthView
        timezone={TZ}
        onHabitPress={vi.fn()}
        habits={[makeHabit({ schedule: { days: [1] } })]} // Mondays
      />,
    );

    expect(screen.getByRole("button", { name: "October 12: 0 of 1 done" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "October 13: nothing scheduled" }),
    ).toBeInTheDocument();
  });
});
