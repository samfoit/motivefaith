import React, { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";

/**
 * The global setup replaces `next/dynamic` with an inert placeholder, which
 * would leave the habit list unrendered. Resolve the real chunk instead — the
 * check-in flow under test lives inside DayView.
 */
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) =>
    React.lazy(() => loader().then((C) => ({ default: C }))),
}));

const mutateAsync = vi.fn().mockResolvedValue({});
vi.mock("@/lib/hooks/useCompleteHabit", () => ({
  useCompleteHabit: () => ({ mutateAsync }),
}));

// The dashboard identifies the user from the Supabase auth cookie, which is
// what keys the query cache. Fix it so the seeded key below matches.
const TEST_USER = "user-1";
vi.mock("@/lib/hooks/useAuthUserId", () => ({
  useAuthUserId: () => TEST_USER,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardClient } from "../dashboard-client";
import { dashboardKey } from "@/lib/hooks/useDashboard";
import type { DashboardData } from "@/lib/data/dashboard";
import { ToastProvider } from "@/components/ui/Toast";

const habit: HabitWithCompletions = {
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
  streak_current: 4,
  streak_best: 12,
  total_completions: 30,
  is_paused: false,
  created_at: "2025-01-01T00:00:00Z",
  completions: [],
};

/**
 * The dashboard reads its data from the React Query cache rather than props,
 * so tests seed the cache. `queryFn` is never reached: seeded data with an
 * infinite staleTime is already fresh.
 */
function renderWithHabits(habits: HabitWithCompletions[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const data: DashboardData = { habits, timezone: "UTC", firstName: "Alice" };
  queryClient.setQueryData(dashboardKey(TEST_USER), data);

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Suspense fallback={null}>
          <DashboardClient />
        </Suspense>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

async function renderDashboard() {
  renderWithHabits([habit]);
  return await screen.findByRole("button", { name: "Complete Morning Run" });
}

describe("DashboardClient quick check-in", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the check-in back while the undo offer is on screen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const complete = await renderDashboard();

    await user.click(complete);

    // Marked done straight away, but nothing has been written yet.
    expect(
      screen.getByRole("button", { name: "Morning Run completed" }),
    ).toBeDisabled();
    expect(screen.getByText("Checked in", { exact: false })).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();

    // ...until the undo window closes.
    await vi.advanceTimersByTimeAsync(6000);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        habitId: "habit-1",
        type: "quick",
      }),
    );
  });

  it("never writes the check-in when undo is clicked", async () => {
    // The toast viewport is click-through by design and each toast re-enables
    // pointer events with a Tailwind class, which jsdom never computes — so
    // the check would reject a button that is perfectly clickable in a browser.
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
      pointerEventsCheck: 0,
    });
    const complete = await renderDashboard();

    await user.click(complete);
    await user.click(screen.getByRole("button", { name: "Undo" }));

    // Back to incomplete, streak restored, and nothing sent — even after the
    // window would have elapsed.
    expect(
      screen.getByRole("button", { name: "Complete Morning Run" }),
    ).not.toBeDisabled();
    expect(screen.getByLabelText("4-day streak")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(6000);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe("DashboardClient rain check", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
  });

  async function takeRainCheck(user: ReturnType<typeof userEvent.setup>) {
    await renderDashboard();
    await user.click(
      screen.getByRole("button", {
        name: "Show check-in options for Morning Run",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rain check for Morning Run" }),
    );
  }

  it("holds the streak instead of advancing it", async () => {
    const user = userEvent.setup();
    await takeRainCheck(user);

    await user.click(screen.getByRole("button", { name: /Sick/ }));
    await user.click(screen.getByRole("button", { name: "Take rain check" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        habitId: "habit-1",
        type: "rain_check",
        evidenceUrl: undefined,
        notes: undefined,
        rainCheckReason: "sick",
      }),
    );

    // Still 4, not 5 — a skip keeps the streak alive without growing it.
    expect(screen.getByLabelText("4-day streak")).toBeInTheDocument();
  });

  it("sends without a reason when none is picked", async () => {
    const user = userEvent.setup();
    await takeRainCheck(user);

    await user.click(screen.getByRole("button", { name: "Take rain check" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "rain_check",
          rainCheckReason: undefined,
        }),
      ),
    );
  });

  it("leaves the habit open to a real check-in afterwards", async () => {
    const user = userEvent.setup();
    await takeRainCheck(user);
    await user.click(screen.getByRole("button", { name: "Take rain check" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    // A rain check settles the day; it must not lock the habit the way a
    // completion does.
    expect(
      screen.getByRole("button", {
        name: "Morning Run rain-checked today — check in anyway",
      }),
    ).not.toBeDisabled();
  });
});

/**
 * A rain check can name the day it will be made up on instead of simply
 * skipping. Time is pinned to Sunday 15 June 2025 so the Mon/Wed/Fri habit
 * below is genuinely off-schedule today — which is the whole point of a
 * makeup appearing at all.
 */
describe("DashboardClient moved rain check", () => {
  const SUNDAY = new Date("2025-06-15T12:00:00Z");

  beforeEach(() => {
    mutateAsync.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(SUNDAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderWith(habits: HabitWithCompletions[]) {
    renderWithHabits(habits);
  }

  const mwf: HabitWithCompletions = {
    ...habit,
    schedule: { days: [1, 3, 5] },
  };

  it("sends the chosen day with the rain check", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Wednesday, so the Mon/Wed/Fri habit is due today and can be moved.
    vi.setSystemTime(new Date("2025-06-18T12:00:00Z"));
    renderWith([mwf]);
    await screen.findByRole("button", { name: "Complete Morning Run" });

    await user.click(
      screen.getByRole("button", {
        name: "Show check-in options for Morning Run",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rain check for Morning Run" }),
    );

    await user.click(
      screen.getByRole("radio", { name: "Move it to another day" }),
    );
    await user.click(screen.getByRole("radio", { name: "Saturday" }));
    await user.click(screen.getByRole("button", { name: "Move to Saturday" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "rain_check",
          rainCheckMovedTo: "2025-06-21",
        }),
      ),
    );
  });

  it("offers only the days the habit is free on", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.setSystemTime(new Date("2025-06-18T12:00:00Z"));
    renderWith([mwf]);
    await screen.findByRole("button", { name: "Complete Morning Run" });

    await user.click(
      screen.getByRole("button", {
        name: "Show check-in options for Morning Run",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rain check for Morning Run" }),
    );
    await user.click(
      screen.getByRole("radio", { name: "Move it to another day" }),
    );

    // Friday and Monday already have their own occurrence, so moving onto
    // them would double-book the day. The picker leaves them out, and arms
    // the first day that is actually free.
    for (const free of ["Thursday", "Saturday", "Sunday", "Tuesday"]) {
      expect(screen.getByRole("radio", { name: free })).toBeInTheDocument();
    }
    for (const busy of ["Friday", "Monday", "Wednesday"]) {
      expect(screen.queryByRole("radio", { name: busy })).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: "Move to Thursday" }),
    ).toBeInTheDocument();
  });

  it("offers no move at all for a habit scheduled every day", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWith([habit]);
    await screen.findByRole("button", { name: "Complete Morning Run" });

    await user.click(
      screen.getByRole("button", {
        name: "Show check-in options for Morning Run",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rain check for Morning Run" }),
    );

    // Every day is already spoken for, so a rain check is a plain skip.
    expect(
      screen.getByRole("button", { name: "Take rain check" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: "Move it to another day" }),
    ).not.toBeInTheDocument();
  });

  it("shows a makeup on the day it was moved to, off-schedule", async () => {
    // Rain-checked Friday 13th, promised for today.
    renderWith([
      {
        ...mwf,
        completions: [
          {
            id: "c1",
            completed_at: "2025-06-13T10:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-15",
          },
        ],
      },
    ]);

    await screen.findByRole("button", { name: "Complete Morning Run" });
    expect(screen.getByText("Moved from Friday")).toBeInTheDocument();
  });

  it("keeps an unmoved habit off a day it is not scheduled for", async () => {
    renderWith([mwf]);
    expect(
      await screen.findByText("No habits scheduled for today"),
    ).toBeInTheDocument();
  });

  it("will not let a makeup itself be rain-checked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWith([
      {
        ...mwf,
        completions: [
          {
            id: "c1",
            completed_at: "2025-06-13T10:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-15",
          },
        ],
      },
    ]);
    await screen.findByRole("button", { name: "Complete Morning Run" });

    await user.click(
      screen.getByRole("button", {
        name: "Show check-in options for Morning Run",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rain check for Morning Run" }),
    );

    // A promise cannot be deferred again, so the sheet never opens.
    expect(
      screen.queryByRole("button", { name: "Take rain check" }),
    ).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("shows where today's rain check went on the card", async () => {
    renderWith([
      {
        // Every day except Tuesday, which is therefore the one day it can
        // move onto — a daily habit could not have been moved at all.
        ...habit,
        schedule: { days: [0, 1, 3, 4, 5, 6] },
        completions: [
          {
            id: "c1",
            completed_at: "2025-06-15T09:00:00Z",
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-17",
          },
        ],
      },
    ]);

    await screen.findByRole("button", {
      name: "Morning Run rain-checked today — check in anyway",
    });
    expect(screen.getByText("Moved to Tuesday")).toBeInTheDocument();
  });
});
