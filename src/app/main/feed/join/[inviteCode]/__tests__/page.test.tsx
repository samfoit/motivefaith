import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

/** `redirect()` ends the render by throwing, as Next's does. */
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string): never => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: nav.redirect }));

interface Found {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  member_count: number;
}

const server = vi.hoisted(() => ({
  userId: "viewer-1" as string | null,
  lookup: { data: [] as unknown[] | null, error: null as { message: string; code: string } | null },
  /** The viewer's own row in the group, which only a member can read. */
  membership: null as { id: string } | null,
  lookedUp: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: async () => ({
    data: { user: server.userId ? { id: server.userId } : null },
    error: null,
  }),
  createServerSupabase: async () => ({
    rpc: async (_name: string, args: { p_code: string }) => {
      server.lookedUp.push(args.p_code);
      return server.lookup;
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: server.membership }) }),
        }),
      }),
    }),
  }),
}));

vi.mock("../join-client", () => ({
  JoinClient: ({
    group,
    inviteCode,
  }: {
    group: { id: string; name: string; memberCount: number };
    inviteCode: string;
  }) => (
    <div data-testid="join-screen">
      {group.name} · {group.memberCount} members · code {inviteCode}
    </div>
  ),
}));

import JoinGroupPage from "../page";

const GROUP: Found = {
  id: "group-1",
  name: "Dawn Patrol",
  description: "Up before the sun",
  avatar_url: null,
  member_count: 5,
};

function open(inviteCode = "dawnpatrol42") {
  return JoinGroupPage({ params: Promise.resolve({ inviteCode }) });
}

beforeEach(() => {
  server.userId = "viewer-1";
  server.lookup = { data: [GROUP], error: null };
  server.membership = null;
  server.lookedUp = [];
  nav.redirect.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("the group invite page", () => {
  it("shows the group the link is for, with how many are in it", async () => {
    render(await open());

    expect(screen.getByTestId("join-screen")).toHaveTextContent(
      "Dawn Patrol · 5 members · code dawnpatrol42",
    );
    expect(server.lookedUp).toEqual(["dawnpatrol42"]);
  });

  it("says the invite wasn't found when the code matches no group", async () => {
    server.lookup = { data: [], error: null };
    render(await open("no-such-code"));

    expect(screen.getByText("Invite not found")).toBeInTheDocument();
    expect(screen.queryByTestId("join-screen")).not.toBeInTheDocument();
  });

  it("does not call a lookup that failed a link that is wrong", async () => {
    // What every valid link met: the lookup itself erroring, read as "no such invite".
    vi.spyOn(console, "error").mockImplementation(() => {});
    server.lookup = {
      data: null,
      error: { message: "INSERT is not allowed in a non-volatile function", code: "0A000" },
    };

    await expect(open()).rejects.toThrow("Couldn't load this invite");
  });

  it("says to wait when the link was tried too many times in a minute", async () => {
    server.lookup = {
      data: null,
      error: { message: "Rate limit exceeded: too many invite code lookups", code: "P0001" },
    };
    render(await open());

    expect(screen.getByText("Too many tries")).toBeInTheDocument();
    expect(screen.getByText("Wait a minute, then open the invite link again.")).toBeInTheDocument();
    expect(screen.queryByText("Invite not found")).not.toBeInTheDocument();
  });

  it("takes someone already in the group straight to it", async () => {
    server.membership = { id: "membership-1" };

    await expect(open()).rejects.toThrow("REDIRECT:/main/feed/group/group-1");
  });

  it("sends a signed-out visitor to sign in without looking anything up", async () => {
    server.userId = null;

    await expect(open()).rejects.toThrow("REDIRECT:/auth/login");
    expect(server.lookedUp).toEqual([]);
  });
});
