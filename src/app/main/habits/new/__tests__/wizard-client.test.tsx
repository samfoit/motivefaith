import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WizardClient } from "../wizard-client";

vi.mock("@/lib/hooks/useAuthUserId", () => ({ useAuthUserId: () => "user-1" }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/hooks/useFriends", () => ({
  useFriendsList: () => ({
    data: [
      {
        id: "friendship-1",
        profile: { id: "bob", display_name: "Bob Smith", username: "bob_smith", avatar_url: null },
      },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/lib/hooks/useGroups", () => ({
  useGroupsList: () => ({ data: [], isLoading: false }),
}));

const sendOrQueue = vi.fn<(entry: unknown, send: () => Promise<unknown>) => Promise<{ queued: boolean }>>(
  async () => ({ queued: false }),
);
vi.mock("@/lib/offline-write", () => ({
  sendOrQueue: (entry: unknown, send: () => Promise<unknown>) => sendOrQueue(entry, send),
}));

function renderWizard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WizardClient />
    </QueryClientProvider>,
  );
}

const next = () => screen.getByRole("button", { name: "Next" });

beforeEach(() => {
  sendOrQueue.mockClear();
  // Each step starts at the top; jsdom has no scrolling to do it with.
  window.scrollTo = vi.fn();
});

describe("WizardClient", () => {
  it("waits for a name before it goes on", async () => {
    renderWizard();

    expect(next()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Habit name"), "Morning Run");
    expect(next()).toBeEnabled();
  });

  it("is two steps: the habit, then the people", async () => {
    renderWizard();

    await userEvent.type(screen.getByLabelText("Habit name"), "Morning Run");
    await userEvent.click(next());

    expect(
      screen.getByRole("radiogroup", { name: /who can find this habit/i }),
    ).toBeInTheDocument();
    // The card carries over, name and all; the last step creates.
    expect(screen.getByLabelText("Habit name")).toHaveValue("Morning Run");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create habit" })).toBeEnabled();
  });

  it("holds Next back while a custom schedule has no days", async () => {
    renderWizard();
    await userEvent.type(screen.getByLabelText("Habit name"), "Stretch");

    await userEvent.click(screen.getByRole("button", { name: /^repeat/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^custom/i }));
    for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      await userEvent.click(screen.getByRole("button", { name: day }));
    }

    expect(next()).toBeDisabled();
  });

  it("creates the habit with what was picked, and invites the partners", async () => {
    renderWizard();

    await userEvent.type(screen.getByLabelText("Habit name"), "  Morning Run ");
    await userEvent.click(screen.getByRole("button", { name: "🏃" }));
    await userEvent.click(next());
    await userEvent.click(screen.getByRole("button", { name: /bob smith/i }));
    await userEvent.click(screen.getByRole("button", { name: "Create habit" }));

    expect(sendOrQueue).toHaveBeenCalledTimes(1);
    expect(sendOrQueue.mock.calls[0][0]).toMatchObject({
      kind: "habit.create",
      userId: "user-1",
      payload: {
        habit: {
          title: "Morning Run",
          emoji: "🏃",
          description: null,
          color: null,
          frequency: "daily",
          schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
          time_window: null,
          visibility: "private",
        },
        friendIds: ["bob"],
        groupIds: [],
      },
    });
  });

  it("creates a habit that keeps a different time at the weekend", async () => {
    renderWizard();

    await userEvent.type(screen.getByLabelText("Habit name"), "Run");
    await userEvent.click(screen.getByRole("switch", { name: /time window/i }));
    await userEvent.click(screen.getByRole("button", { name: "Different time on some days" }));
    // Queried afresh each time: the test setup's motion mock remounts what it wraps.
    const weekend = () => screen.getByRole("group", { name: "Different time 1" });
    fireEvent.change(within(weekend()).getByLabelText("From"), { target: { value: "16:00" } });
    fireEvent.change(within(weekend()).getByLabelText("Until"), { target: { value: "17:00" } });
    await userEvent.click(next());
    await userEvent.click(screen.getByRole("button", { name: "Create habit" }));

    expect(sendOrQueue.mock.calls[0][0]).toMatchObject({
      kind: "habit.create",
      payload: {
        habit: {
          title: "Run",
          schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
          time_window: {
            start: "09:00",
            end: "12:00",
            days: {
              "0": { start: "16:00", end: "17:00" },
              "6": { start: "16:00", end: "17:00" },
            },
          },
        },
      },
    });
  });
});
