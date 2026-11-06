import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FriendFeedRow } from "@/lib/types/feed";
import type { GroupFeedRow } from "@/lib/types/groups";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    createClient: () => ({ channel: () => channel, removeChannel: vi.fn() }),
  };
});

import { FeedClient } from "../feed-client";

function friend(id: string, name: string, username: string, habits: string[] = []): FriendFeedRow {
  return {
    friend: { id, display_name: name, avatar_url: null, username },
    sharedHabits: habits.map((title) => ({ emoji: "✅", title })),
    latestActivity: null,
    previewText: "No shared activity yet",
    hasNewActivity: false,
    friendshipSince: "2026-01-01",
  };
}

function group(id: string, name: string): GroupFeedRow {
  return {
    group: { id, name, avatar_url: null },
    memberCount: 3,
    previewText: "Nothing in the last 24 hours",
    latestActivity: null,
    hasNewActivity: false,
    myRole: "member",
  };
}

const FRIENDS = [
  friend("f1", "Sam Rivera", "sam_r", ["Morning Run"]),
  friend("f2", "José Ortiz", "jortiz", ["Scripture Reading"]),
  friend("f3", "Ana Lee", "analee"),
];
const GROUPS = [group("g1", "Run Club"), group("g2", "Bible Study")];

function renderFeed(friends = FRIENDS, groups = GROUPS) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FeedClient userId="me" friends={friends} groups={groups} />
    </QueryClientProvider>,
  );
  return screen.getByRole("searchbox", { name: "Search your feed" });
}

/** The names of the rows on screen, in order. */
function rows() {
  return screen.getAllByRole("link").map((a) => a.textContent ?? "");
}

describe("Feed search", () => {
  it("finds friends by name, accents aside, and groups by name", () => {
    const search = renderFeed();
    fireEvent.change(search, { target: { value: "jose" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("José Ortiz");

    fireEvent.change(search, { target: { value: "bible" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Bible Study");
  });

  it("finds a friend by @username or by a habit you share", () => {
    const search = renderFeed();
    fireEvent.change(search, { target: { value: "@analee" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Ana Lee");

    // "run" is Sam's shared habit and the Run Club group.
    fireEvent.change(search, { target: { value: "run" } });
    expect(rows()).toHaveLength(2);
  });

  it("searches within the chosen tab", () => {
    const search = renderFeed();
    fireEvent.click(screen.getByRole("button", { name: "groups" }));
    fireEvent.change(search, { target: { value: "run" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Run Club");
  });

  it("says when nothing matches, and clears from there", () => {
    const search = renderFeed();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No friends or groups match “zzz”")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(rows()).toHaveLength(5);
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
  });

  it("clears with Escape and with the clear button", () => {
    const search = renderFeed();
    fireEvent.change(search, { target: { value: "sam" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(rows()).toHaveLength(5);

    fireEvent.change(search, { target: { value: "sam" } });
    fireEvent.click(within(search.parentElement!).getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
  });

  it("announces how many rows a search leaves", () => {
    const search = renderFeed();
    fireEvent.change(search, { target: { value: "sam" } });
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("isn't shown when there's nothing to search", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FeedClient userId="me" friends={[]} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("No friends yet")).toBeInTheDocument();
  });
});
