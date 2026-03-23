import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { HabitCard, type HabitWithCompletions } from "../HabitCard";

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
    category: "fitness",
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
    expect(screen.getByText(/5-day streak/)).toBeInTheDocument();
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

    expect(onQuickComplete).toHaveBeenCalledWith("habit-1");
    expect(onQuickComplete).toHaveBeenCalledTimes(1);
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

    // Click the card div itself (not the button)
    const card = container.firstChild as HTMLElement;
    await user.click(card);

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

    const card = container.firstChild as HTMLElement;
    await user.click(card);

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
});
