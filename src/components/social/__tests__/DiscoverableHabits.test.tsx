import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscoverableHabits } from "../DiscoverableHabits";
import type { ProfileHabit } from "@/lib/types/partners";

const request = vi.fn();
const cancel = vi.fn();

vi.mock("@/lib/hooks/usePartnerActions", () => ({
  useRequestPartner: () => ({ mutateAsync: request }),
  useCancelPartner: () => ({ mutateAsync: cancel }),
}));

function makeHabit(overrides: Partial<ProfileHabit> = {}): ProfileHabit {
  return {
    habitId: "habit-1",
    title: "Morning Run",
    emoji: "🏃",
    color: "#EF4444",
    visibility: "public",
    partnerStatus: null,
    shareId: null,
    isInitiator: false,
    streakCurrent: null,
    streakBest: null,
    ...overrides,
  };
}

describe("DiscoverableHabits", () => {
  beforeEach(() => {
    request.mockReset().mockResolvedValue(undefined);
    cancel.mockReset().mockResolvedValue(undefined);
  });

  it("renders nothing when there is nothing to discover", () => {
    const { container } = render(
      <DiscoverableHabits habits={[]} friendName="Alice" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to ask when there is no partnership yet", async () => {
    render(<DiscoverableHabits habits={[makeHabit()]} friendName="Alice" />);

    await userEvent.click(
      screen.getByRole("button", { name: /Ask to partner/ }),
    );

    expect(request).toHaveBeenCalledWith("habit-1");
  });

  it("shows a request you already sent, with a way to take it back", async () => {
    render(
      <DiscoverableHabits
        habits={[
          makeHabit({
            partnerStatus: "pending",
            isInitiator: true,
            shareId: "share-1",
          }),
        ]}
        friendName="Alice"
      />,
    );

    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Ask to partner/ }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Withdraw request/ }),
    );
    expect(cancel).toHaveBeenCalledWith("share-1");
  });

  it("points an invitation at the inbox rather than answering it here", () => {
    render(
      <DiscoverableHabits
        habits={[
          makeHabit({
            partnerStatus: "pending",
            isInitiator: false,
            shareId: "share-1",
          }),
        ]}
        friendName="Alice"
      />,
    );

    const link = screen.getByRole("link", { name: "Invited you" });
    expect(link).toHaveAttribute("href", "/main/inbox");
    expect(screen.queryByRole("button", { name: /Ask/ })).not.toBeInTheDocument();
  });

  it("never shows a streak — that is what partnering is for", () => {
    render(
      <DiscoverableHabits
        habits={[makeHabit({ streakCurrent: null })]}
        friendName="Alice"
      />,
    );
    expect(screen.getByText(/see their streak once they accept/i)).toBeInTheDocument();
  });
});
