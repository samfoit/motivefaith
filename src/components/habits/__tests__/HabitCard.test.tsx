import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HabitCard, type HabitWithCompletions } from "../HabitCard";
import { useHabitDrawerStore } from "@/lib/stores/habit-drawer-store";

/** The sliding card surface — the click target for "tapping the card". */
function surfaceOf(container: HTMLElement): HTMLElement {
  const surface = container.querySelector(".hc-surface");
  if (!surface) throw new Error("card surface not found");
  return surface as HTMLElement;
}

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

function makeHabit(overrides: Partial<HabitWithCompletions> = {}): HabitWithCompletions {
  return {
    id: "habit-1",
    user_id: "user-1",
    title: "Morning Run",
    description: "Go for a 5k",
    emoji: "🏃",
    color: "#EF4444",
    frequency: "daily",
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
    time_window: null,
    is_shared: false,
    streak_current: 5,
    streak_best: 12,
    total_completions: 30,
    is_paused: false,
    created_at: "2025-01-01T00:00:00Z",
    completions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HabitCard", () => {
  beforeEach(() => {
    useHabitDrawerStore.setState({ openHabitId: null });
  });

  it("renders habit title, emoji, and streak", () => {
    render(
      <HabitCard
        habit={makeHabit()}
        completedToday={false}
        onQuickComplete={vi.fn()}
      />,
    );

    expect(screen.getByText("Morning Run")).toBeInTheDocument();
    expect(screen.getByText("🏃")).toBeInTheDocument();
    expect(screen.getByLabelText("5-day streak")).toBeInTheDocument();
  });

  it("shows complete button with correct aria label", () => {
    render(
      <HabitCard
        habit={makeHabit()}
        completedToday={false}
        onQuickComplete={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: "Complete Morning Run" });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("disables complete button when already completed", () => {
    render(
      <HabitCard
        habit={makeHabit()}
        completedToday={true}
        onQuickComplete={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: "Morning Run completed" });
    expect(btn).toBeDisabled();
  });

  it("calls onQuickComplete when tapping the complete button", async () => {
    const user = userEvent.setup();
    const onQuickComplete = vi.fn();

    render(
      <HabitCard
        habit={makeHabit()}
        completedToday={false}
        onQuickComplete={onQuickComplete}
      />,
    );

    const btn = screen.getByRole("button", { name: "Complete Morning Run" });
    await user.click(btn);

    // The second argument is the centre of the button, used as the origin for
    // the completion flyout animation. jsdom reports a zero-sized rect, so
    // assert the shape rather than the coordinates.
    expect(onQuickComplete).toHaveBeenCalledTimes(1);
    expect(onQuickComplete).toHaveBeenCalledWith(
      "habit-1",
      { x: expect.any(Number), y: expect.any(Number) },
    );
  });

  it("does not call onQuickComplete when already completed", async () => {
    const user = userEvent.setup();
    const onQuickComplete = vi.fn();

    render(
      <HabitCard
        habit={makeHabit()}
        completedToday={true}
        onQuickComplete={onQuickComplete}
      />,
    );

    const btn = screen.getByRole("button", { name: "Morning Run completed" });
    await user.click(btn);

    expect(onQuickComplete).not.toHaveBeenCalled();
  });

  it("hides the challenge tag when it only repeats the habit title", () => {
    render(
      <HabitCard
        habit={makeHabit({
          title: "7-Day Early Bird",
          challenge: { title: "7-Day Early Bird", emoji: "🌅" },
        })}
        completedToday={false}
        onQuickComplete={vi.fn()}
      />,
    );

    // The title itself still renders; the tag beside it does not.
    expect(screen.getByRole("heading", { name: "7-Day Early Bird" }))
      .toBeInTheDocument();
    expect(screen.queryByText(/🌅/)).not.toBeInTheDocument();
  });

  it("keeps the challenge tag when it names a different challenge", () => {
    render(
      <HabitCard
        habit={makeHabit({
          title: "Morning Run",
          challenge: { title: "7-Day Early Bird", emoji: "🌅" },
        })}
        completedToday={false}
        onQuickComplete={vi.fn()}
      />,
    );

    expect(screen.getByText(/7-Day Early Bird/)).toBeInTheDocument();
  });

  it("does not show streak when streak is 0", () => {
    render(
      <HabitCard
        habit={makeHabit({ streak_current: 0 })}
        completedToday={false}
        onQuickComplete={vi.fn()}
      />,
    );

    expect(screen.queryByText(/streak/)).not.toBeInTheDocument();
  });

  it("calls onPress when clicking the card body (completed habit)", async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();

    const { container } = render(
      <HabitCard
        habit={makeHabit()}
        completedToday={true}
        onQuickComplete={vi.fn()}
        onPress={onPress}
      />,
    );

    await user.click(surfaceOf(container));

    expect(onPress).toHaveBeenCalledWith("habit-1");
  });

  it("calls onPress when clicking card body (incomplete habit)", async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();

    const { container } = render(
      <HabitCard
        habit={makeHabit()}
        completedToday={false}
        onQuickComplete={vi.fn()}
        onPress={onPress}
      />,
    );

    await user.click(surfaceOf(container));

    expect(onPress).toHaveBeenCalledWith("habit-1");
  });

  it("shows last completion time", () => {
    const recentTime = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour ago

    render(
      <HabitCard
        habit={makeHabit({
          completions: [
            { id: "c-1", completed_at: recentTime, completion_type: "quick" },
          ],
        })}
        completedToday={false}
        onQuickComplete={vi.fn()}
      />,
    );

    // formatDistanceToNow will render something like "about 1 hour ago"
    expect(screen.getByText(/hour ago/i)).toBeInTheDocument();
  });

  it("opens the check-in drawer from the chevron and reports the choice", async () => {
    const user = userEvent.setup();
    const onCheckIn = vi.fn();
    const onPress = vi.fn();

    render(
      <HabitCard
        habit={makeHabit()}
        completedToday={false}
        onQuickComplete={vi.fn()}
        onPress={onPress}
        onCheckIn={onCheckIn}
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Show check-in options for Morning Run",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(
      screen.getByRole("button", {
        name: "Hide check-in options for Morning Run",
      }),
    ).toHaveAttribute("aria-expanded", "true");

    await user.click(
      screen.getByRole("button", { name: "Voice note for Morning Run" }),
    );

    expect(onCheckIn).toHaveBeenCalledWith(
      "habit-1",
      "voice",
      { x: expect.any(Number), y: expect.any(Number) },
    );
    // Picking an option closes the drawer and never navigates.
    expect(useHabitDrawerStore.getState().openHabitId).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("closes an open drawer instead of navigating when the card is tapped", async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();

    const { container } = render(
      <HabitCard
        habit={makeHabit()}
        completedToday={false}
        onQuickComplete={vi.fn()}
        onPress={onPress}
        onCheckIn={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Show check-in options for Morning Run",
      }),
    );
    await user.click(surfaceOf(container));

    expect(useHabitDrawerStore.getState().openHabitId).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("offers no check-in drawer once the habit is done for the day", () => {
    render(
      <HabitCard
        habit={makeHabit()}
        completedToday={true}
        onQuickComplete={vi.fn()}
        onCheckIn={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /check-in options/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Quick check-in/ }),
    ).not.toBeInTheDocument();
  });

  describe("rain check", () => {
    it("offers a rain check from the drawer", async () => {
      const user = userEvent.setup();
      const onCheckIn = vi.fn();

      render(
        <HabitCard
          habit={makeHabit()}
          completedToday={false}
          onQuickComplete={vi.fn()}
          onCheckIn={onCheckIn}
        />,
      );

      await user.click(
        screen.getByRole("button", {
          name: "Show check-in options for Morning Run",
        }),
      );
      await user.click(
        screen.getByRole("button", { name: "Rain check for Morning Run" }),
      );

      expect(onCheckIn).toHaveBeenCalledWith(
        "habit-1",
        "rain_check",
        { x: expect.any(Number), y: expect.any(Number) },
      );
    });

    it("shows the rain-check state but keeps the habit actionable", async () => {
      const user = userEvent.setup();
      const onCheckIn = vi.fn();

      render(
        <HabitCard
          habit={makeHabit()}
          completedToday={false}
          rainCheckedToday
          onQuickComplete={vi.fn()}
          onCheckIn={onCheckIn}
        />,
      );

      expect(screen.getByText("Rain check")).toBeInTheDocument();

      // Unlike a completion, a rain check does not close the day off: the
      // drawer is still there and the circle still invites a real check-in.
      const circle = screen.getByRole("button", {
        name: "Morning Run rain-checked today — check in anyway",
      });
      expect(circle).not.toBeDisabled();

      await user.click(
        screen.getByRole("button", {
          name: "Show check-in options for Morning Run",
        }),
      );
      expect(
        screen.getByRole("button", { name: "Quick check-in for Morning Run" }),
      ).toBeInTheDocument();
    });

    it("hides the drawer once the habit is genuinely completed", () => {
      render(
        <HabitCard
          habit={makeHabit()}
          completedToday
          rainCheckedToday
          onQuickComplete={vi.fn()}
          onCheckIn={vi.fn()}
        />,
      );

      expect(
        screen.queryByRole("button", { name: /Rain check for/ }),
      ).not.toBeInTheDocument();
    });
  });
});
