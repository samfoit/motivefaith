import React, { Suspense } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// Only the sharing question calls an RPC from here: recording the yes.
const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/rpc", () => ({
  untypedRpc: (_client: unknown, name: string) => rpc(name),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardClient } from "../dashboard-client";
import { dashboardKey } from "@/lib/hooks/useDashboard";
import type { DashboardData } from "@/lib/data/dashboard";
import {
  checkinSharingKey,
  type AudienceMember,
  type CheckinSharing,
} from "@/lib/data/checkin-sharing";
import { useCheckinSharingStore } from "@/lib/stores/checkin-sharing-store";
import { CheckinSharingDialog } from "@/components/habits/CheckinSharingDialog";
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
  private_checkins: false,
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
function renderWithHabits(
  habits: HabitWithCompletions[],
  // Someone who has already said their check-ins may be shared, unless a
  // test says otherwise. The one-time question has its own tests at the end.
  sharing: CheckinSharing = { confirmed: true, audience: [] },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const data: DashboardData = { habits, timezone: "UTC", firstName: "Alice" };
  queryClient.setQueryData(dashboardKey(TEST_USER), data);
  queryClient.setQueryData(checkinSharingKey(TEST_USER), sharing);

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Suspense fallback={null}>
          <DashboardClient />
        </Suspense>
        {/* Mounted beside every page by the layout. */}
        <CheckinSharingDialog />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

let queryClient: QueryClient;

async function renderDashboard() {
  queryClient = renderWithHabits([habit]);
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

  it("is not undone by a refetch while the check-in is held back", async () => {
    // The server has not been sent the check-in yet, so any refetch in the
    // window — returning to the app, say — answers without it.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ habits: [habit], timezone: "UTC", firstName: "Alice" }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const complete = await renderDashboard();

      await user.click(complete);
      // What a window-focus refetch does.
      await queryClient.refetchQueries({ type: "active" });
      await vi.advanceTimersByTimeAsync(0);

      expect(
        screen.getByRole("button", { name: "Morning Run completed" }),
      ).toBeDisabled();
      expect(screen.getByLabelText("5-day streak")).toBeInTheDocument();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/**
 * A habit can be done more than once a day. The first check-in completes it
 * and advances the streak; every one after it is logged and shared the same
 * way, but the day is already in the streak.
 */
describe("DashboardClient checking in again", () => {
  // Noon on Wednesday 18 June 2025, UTC, with Morning Run done at 8.
  const NOW = new Date("2025-06-18T12:00:00Z");
  const doneToday: HabitWithCompletions = {
    ...habit,
    completions: [
      { id: "c1", completed_at: "2025-06-18T08:00:00Z", completion_type: "quick" },
    ],
  };

  beforeEach(() => {
    mutateAsync.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      await screen.findByRole("button", {
        name: "Show check-in options for Morning Run",
      }),
    );
  }

  it("logs a quick check-in on a habit already done, without moving the streak", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithHabits([doneToday]);

    // The circle stays done: a second tap there is not how you do it again.
    expect(
      await screen.findByRole("button", { name: "Morning Run completed" }),
    ).toBeDisabled();

    await openDrawer(user);
    await user.click(
      screen.getByRole("button", { name: "Quick check-in for Morning Run" }),
    );

    expect(screen.getByText("Checked in again", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("2 check-ins today")).toBeInTheDocument();
    expect(screen.getByLabelText("4-day streak")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(6000);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ habitId: "habit-1", type: "quick" }),
    );
  });

  it("does not celebrate a milestone the first check-in already reached", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Day 7 was this morning's check-in; a note now is not day 8.
    renderWithHabits([{ ...doneToday, streak_current: 6 }]);

    await openDrawer(user);
    await user.click(
      screen.getByRole("button", { name: "Written note for Morning Run" }),
    );
    await user.type(await screen.findByRole("textbox"), "Ran it again at lunch");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ type: "message", notes: "Ran it again at lunch" }),
      ),
    );
    expect(screen.getByLabelText("6-day streak")).toBeInTheDocument();
    expect(screen.queryByText(/One week faithful/)).not.toBeInTheDocument();
  });

  it("offers no rain check once the habit is done", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithHabits([doneToday]);

    await openDrawer(user);
    expect(
      screen.queryByRole("button", { name: "Rain check for Morning Run" }),
    ).not.toBeInTheDocument();

    // Nor from the sheet's own picker, reached by backing out of a note.
    await user.click(
      screen.getByRole("button", { name: "Written note for Morning Run" }),
    );
    await user.click(await screen.findByRole("button", { name: "Go back" }));
    expect(await screen.findByText("Just log it")).toBeInTheDocument();
    expect(screen.queryByText("Rain check")).not.toBeInTheDocument();
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

describe("DashboardClient sharing the first check-in", () => {
  const PAT: AudienceMember = {
    habit_id: "habit-1",
    kind: "partner",
    id: "pat",
    name: "Pat",
    avatar_url: null,
  };
  /** A user who has never said yes, with Pat watching Morning Run. */
  const UNCONFIRMED: CheckinSharing = { confirmed: false, audience: [PAT] };

  const nap: HabitWithCompletions = {
    ...habit,
    id: "habit-2",
    title: "Nap",
    emoji: "😴",
  };

  beforeEach(() => {
    mutateAsync.mockClear();
    rpc.mockClear();
    useCheckinSharingStore.setState({ question: null, waiting: [] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks before the first check-in a partner would see, and sends nothing on \"Not now\"", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithHabits([habit], UNCONFIRMED);

    await user.click(
      await screen.findByRole("button", { name: "Complete Morning Run" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Your partners will see this",
    });
    expect(dialog).toHaveTextContent("Pat");

    await user.click(within(dialog).getByRole("button", { name: "Not now" }));

    // Never marked done, never offered an undo, never sent.
    expect(
      screen.getByRole("button", { name: "Complete Morning Run" }),
    ).not.toBeDisabled();
    expect(screen.queryByText("Checked in", { exact: false })).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(6000);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("checks in on yes, and never asks again", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithHabits([habit, nap], {
      confirmed: false,
      audience: [PAT, { ...PAT, habit_id: "habit-2" }],
    });

    await user.click(
      await screen.findByRole("button", { name: "Complete Morning Run" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("button", { name: "Morning Run completed" }),
    ).toBeDisabled();
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("confirm_checkin_sharing"),
    );

    // Pat watches Nap too, and that goes straight through.
    await user.click(screen.getByRole("button", { name: "Complete Nap" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nap completed" })).toBeDisabled();

    await vi.advanceTimersByTimeAsync(6000);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
  });

  it("checks in once for a second tap made while the question was coming up", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithHabits([habit], UNCONFIRMED);

    const complete = await screen.findByRole("button", {
      name: "Complete Morning Run",
    });
    fireEvent.click(complete);
    fireEvent.click(complete);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(screen.getByLabelText("5-day streak")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(6000);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("asks before the note is written, so \"Not now\" loses nothing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithHabits([habit], UNCONFIRMED);
    await screen.findByRole("button", { name: "Complete Morning Run" });

    await user.click(
      screen.getByRole("button", {
        name: "Show check-in options for Morning Run",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Written note for Morning Run" }),
    );
    const dialog = await screen.findByRole("alertdialog");

    // The sheet waits behind the question rather than opening under it.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("textbox")).toBeInTheDocument();
  });

  it("lets a check-in nobody else sees straight through", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Pat watches some other habit; Morning Run has nobody on it.
    renderWithHabits([habit], {
      confirmed: false,
      audience: [{ ...PAT, habit_id: "habit-elsewhere" }],
    });

    await user.click(
      await screen.findByRole("button", { name: "Complete Morning Run" }),
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Morning Run completed" }),
    ).toBeDisabled();
  });
});

/**
 * A habit can keep a different time on some days, or none at all. Its
 * section and the time on its card are today's.
 */
describe("DashboardClient times that differ by day", () => {
  // 8 to 9, but 4 to 5 at the weekend, and any time on Tuesday.
  const split: HabitWithCompletions = {
    ...habit,
    time_window: {
      start: "08:00",
      end: "09:00",
      days: {
        "0": { start: "16:00", end: "17:00" },
        "6": { start: "16:00", end: "17:00" },
        "2": null,
      },
    },
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The heading of the section a habit's card sits in on a given day. */
  async function placedOn(day: string) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(day));
    renderWithHabits([split]);
    const card = await screen.findByRole("button", { name: "Complete Morning Run" });
    const heading = screen
      .getAllByRole("heading", { level: 2 })
      .find((h) => h.parentElement?.contains(card));
    return { heading: heading?.textContent, section: heading!.parentElement! };
  }

  it("shows the usual time on a weekday", async () => {
    const { heading, section } = await placedOn("2025-06-18T07:00:00Z"); // Wednesday
    expect(heading).toBe("Morning");
    expect(within(section).getByText("8 AM")).toBeInTheDocument();
  });

  it("shows the weekend's own time at the weekend", async () => {
    const { heading, section } = await placedOn("2025-06-21T07:00:00Z"); // Saturday
    expect(heading).toBe("Afternoon");
    expect(within(section).getByText("4 PM")).toBeInTheDocument();
  });

  it("lists a day with no set time under Anytime, with no time", async () => {
    const { heading, section } = await placedOn("2025-06-17T07:00:00Z"); // Tuesday
    expect(heading).toBe("Anytime");
    expect(within(section).queryByText(/\d (AM|PM)$/)).not.toBeInTheDocument();
  });
});
