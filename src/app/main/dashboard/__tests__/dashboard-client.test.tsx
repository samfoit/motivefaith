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

import { DashboardClient } from "../dashboard-client";
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
  category: "fitness",
  is_shared: false,
  streak_current: 4,
  streak_best: 12,
  total_completions: 30,
  is_paused: false,
  created_at: "2025-01-01T00:00:00Z",
  completions: [],
};

async function renderDashboard() {
  render(
    <ToastProvider>
      <Suspense fallback={null}>
        <DashboardClient habits={[habit]} timezone="UTC" initialView="day" />
      </Suspense>
    </ToastProvider>,
  );
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
    expect(screen.getByText(/4-day streak/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(6000);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
