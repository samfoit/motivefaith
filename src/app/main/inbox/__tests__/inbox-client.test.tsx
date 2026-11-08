import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InboxClient } from "../inbox-client";
import { ToastProvider } from "@/components/ui/Toast";
import { forgetLateHabitDismissals } from "@/lib/stores/late-habit-dismissals";
import type { LateHabit } from "@/lib/types/late-habits";
import type { PartnerInboxItem } from "@/lib/types/partners";

const respond = vi.fn();

vi.mock("@/lib/hooks/usePartnerActions", () => ({
  useRespondToPartner: () => ({ mutateAsync: respond }),
}));

// The list arrives from the server; nothing here should go fetch it again.
vi.mock("@/lib/data/late-habits", () => ({
  fetchLateHabits: vi.fn(async () => []),
}));

function makeLate(overrides: Partial<LateHabit> = {}): LateHabit {
  return {
    habitId: "habit-run",
    title: "Morning Run",
    emoji: "🏃",
    color: "#EF4444",
    ownerId: "friend-1",
    ownerName: "Alice Johnson",
    ownerAvatar: null,
    kind: "encourage",
    day: "2026-11-01",
    closedAt: "2026-11-01T15:00:00Z",
    ...overrides,
  };
}

function makeItem(overrides: Partial<PartnerInboxItem> = {}): PartnerInboxItem {
  return {
    shareId: "share-1",
    habitId: "habit-1",
    habitTitle: "Morning Run",
    habitEmoji: "🏃",
    habitColor: "#EF4444",
    visibility: "private",
    direction: "invite",
    person: {
      id: "friend-1",
      display_name: "Alice Johnson",
      avatar_url: null,
      username: "alice",
    },
    createdAt: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

function renderInbox(items: PartnerInboxItem[], lateHabits: LateHabit[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The root layout's ToastProvider: answering shows a toast, which throws
  // without one, after the test that clicked has already passed.
  return render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <InboxClient lateHabits={lateHabits} partnerItems={items} userId="me" />
      </QueryClientProvider>
    </ToastProvider>,
  );
}

describe("InboxClient partnership sections", () => {
  beforeEach(() => {
    respond.mockReset();
    respond.mockResolvedValue(undefined);
  });

  it("separates invitations from requests", () => {
    renderInbox([
      makeItem(),
      makeItem({
        shareId: "share-2",
        direction: "request",
        habitTitle: "Meditation",
        habitEmoji: "🧘",
        person: {
          id: "friend-2",
          display_name: "Bob Smith",
          avatar_url: null,
          username: "bob",
        },
      }),
    ]);

    expect(screen.getByText("Invitations")).toBeInTheDocument();
    expect(screen.getByText("Follow requests")).toBeInTheDocument();
    expect(screen.getByText(/invited you to follow/)).toBeInTheDocument();
    expect(screen.getByText(/asked to follow/)).toBeInTheDocument();
  });

  it("accepts an invitation by its share id", async () => {
    renderInbox([makeItem()]);

    await userEvent.click(screen.getByRole("button", { name: /Accept Alice Johnson/ }));

    expect(respond).toHaveBeenCalledWith({ shareId: "share-1", accept: true });
    expect(await screen.findByText("Now following Morning Run")).toBeInTheDocument();
  });

  it("declines without accepting", async () => {
    renderInbox([makeItem()]);

    await userEvent.click(
      screen.getByRole("button", { name: /Decline Alice Johnson/ }),
    );

    expect(respond).toHaveBeenCalledWith({ shareId: "share-1", accept: false });
    expect(await screen.findByText("Declined")).toBeInTheDocument();
  });

  it("does not claim all-caught-up while something is unanswered", () => {
    renderInbox([makeItem()]);
    expect(screen.queryByText("All caught up")).not.toBeInTheDocument();
  });

  it("is caught up when there is nothing at all", () => {
    renderInbox([]);
    expect(screen.getByText("All caught up")).toBeInTheDocument();
  });
});

describe("InboxClient late habits", () => {
  beforeEach(() => {
    localStorage.clear();
    forgetLateHabitDismissals();
  });

  it("lists friends' habits that could use a word, each opening their chat", () => {
    renderInbox([], [makeLate()]);

    expect(screen.getByRole("heading", { name: "Could use a word" })).toBeInTheDocument();
    const row = screen.getByRole("link", { name: /Alice Johnson/ });
    expect(row).toHaveAttribute("href", "/main/feed/friend-1");
    expect(row).toHaveTextContent("🏃 Morning Run");
    expect(row).toHaveTextContent(/Missed/);
    expect(screen.queryByText("All caught up")).not.toBeInTheDocument();
  });

  it("dismisses one for good, and is caught up once none is left", () => {
    const { unmount } = renderInbox([], [makeLate()]);

    act(() => screen.getByRole("button", { name: "Dismiss Alice Johnson" }).click());
    expect(screen.queryByRole("link", { name: /Alice Johnson/ })).not.toBeInTheDocument();
    expect(screen.getByText("All caught up")).toBeInTheDocument();
    unmount();

    // Back to the inbox later: still dismissed, here and in Alice's chat.
    renderInbox([], [makeLate()]);
    expect(screen.queryByRole("link", { name: /Alice Johnson/ })).not.toBeInTheDocument();
  });

  it("gives each friend one card, previewing three of theirs", () => {
    renderInbox(
      [],
      ["Run", "Read", "Pray", "Stretch", "Journal"].map((title) =>
        makeLate({ habitId: title, title, kind: "remind" }),
      ),
    );

    const card = screen.getByRole("link", { name: /Alice Johnson/ });
    expect(screen.getAllByRole("link", { name: /Alice Johnson/ })).toHaveLength(1);
    expect(card).toHaveTextContent("Pray");
    expect(card).not.toHaveTextContent("Stretch");
    expect(card).toHaveTextContent("and 2 more");
  });
});
