import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InboxClient } from "../inbox-client";
import type { PartnerInboxItem } from "@/lib/types/partners";

const respond = vi.fn();

vi.mock("@/lib/hooks/usePartnerActions", () => ({
  useRespondToPartner: () => ({ mutateAsync: respond }),
}));

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

function renderInbox(items: PartnerInboxItem[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InboxClient missedHabits={[]} partnerItems={items} userId="me" />
    </QueryClientProvider>,
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
  });

  it("declines without accepting", async () => {
    renderInbox([makeItem()]);

    await userEvent.click(
      screen.getByRole("button", { name: /Decline Alice Johnson/ }),
    );

    expect(respond).toHaveBeenCalledWith({ shareId: "share-1", accept: false });
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
