import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { FriendProfileSheet } from "../FriendProfileSheet";
import type { ProfileHabit } from "@/lib/types/partners";

const request = vi.fn();
const cancel = vi.fn();
const respond = vi.fn();
let habits: ProfileHabit[] = [];

vi.mock("@/lib/hooks/useProfileHabits", () => ({
  useProfileHabits: () => ({ data: habits, isLoading: false }),
}));
vi.mock("@/lib/hooks/usePartnerActions", () => ({
  useRequestPartner: () => ({ mutateAsync: request }),
  useCancelPartner: () => ({ mutateAsync: cancel }),
  useRespondToPartner: () => ({ mutateAsync: respond }),
}));

const FRIEND = {
  id: "friend-1",
  display_name: "Alice Johnson",
  avatar_url: null,
  username: "alice",
};

function habit(over: Partial<ProfileHabit> = {}): ProfileHabit {
  return {
    habitId: "h1",
    title: "Morning Run",
    emoji: "🏃",
    color: "#EF4444",
    visibility: "public",
    partnerStatus: null,
    shareId: null,
    isInitiator: false,
    streakCurrent: null,
    streakBest: null,
    ...over,
  };
}

// The app mounts ToastProvider at the root layout; the sheet's success and
// error toasts need it here too.
const renderSheet = () =>
  render(
    <ToastProvider>
      <FriendProfileSheet friend={FRIEND} open onOpenChange={vi.fn()} />
    </ToastProvider>,
  );

describe("FriendProfileSheet", () => {
  beforeEach(() => {
    habits = [];
    for (const m of [request, cancel, respond]) {
      m.mockReset();
      m.mockResolvedValue(undefined);
    }
  });

  it("asks to partner on a habit with no relationship yet", async () => {
    habits = [habit()];
    renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /^Follow$/ }));
    expect(request).toHaveBeenCalledWith("h1");
  });

  it("decides an invitation without leaving for the inbox", async () => {
    habits = [
      habit({ partnerStatus: "pending", isInitiator: false, shareId: "s1" }),
    ];
    renderSheet();

    expect(screen.getByText("Invited you")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(respond).toHaveBeenCalledWith({ shareId: "s1", accept: true });

    await userEvent.click(
      screen.getByRole("button", { name: /Decline Morning Run/ }),
    );
    expect(respond).toHaveBeenLastCalledWith({ shareId: "s1", accept: false });
  });

  it("withdraws a request it already sent", async () => {
    habits = [
      habit({ partnerStatus: "pending", isInitiator: true, shareId: "s2" }),
    ];
    renderSheet();

    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Follow$/ })).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Withdraw request/ }),
    );
    expect(cancel).toHaveBeenCalledWith("s2");
  });

  it("shows the streak only once partnered", () => {
    habits = [
      habit({ partnerStatus: "accepted", shareId: "s3", streakCurrent: 9 }),
      habit({ habitId: "h2", title: "Journal", emoji: "📓" }),
    ];
    renderSheet();

    expect(screen.getByText("Following")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    // the un-partnered one offers the ask, and carries no number
    expect(screen.getByRole("button", { name: /^Follow$/ })).toBeInTheDocument();
  });

  it("separates the four states into their own groups", () => {
    habits = [
      habit({ habitId: "a", partnerStatus: "pending", isInitiator: false, shareId: "s1" }),
      habit({ habitId: "b", partnerStatus: "accepted", shareId: "s2", streakCurrent: 3 }),
      habit({ habitId: "c", partnerStatus: "pending", isInitiator: true, shareId: "s3" }),
      habit({ habitId: "d" }),
    ];
    renderSheet();

    expect(screen.getByText("Invited you")).toBeInTheDocument();
    expect(screen.getByText("Following")).toBeInTheDocument();
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText(/Alice's other habits/)).toBeInTheDocument();
  });
});
