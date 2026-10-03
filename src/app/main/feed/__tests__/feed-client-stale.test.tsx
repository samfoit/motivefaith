import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    createClient: () => ({
      channel: () => channel,
      removeChannel: vi.fn(),
    }),
  };
});

import { FeedClient } from "../feed-client";
import { useFeedStaleStore } from "@/lib/stores/feed-stale-store";

function renderFeed() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <FeedClient userId="me" friends={[]} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  refresh.mockReset();
  useFeedStaleStore.setState({ stale: false });
});

describe("FeedClient — the viewer's own check-ins", () => {
  it("does not refresh when nothing has been written", () => {
    renderFeed();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes on mount after a check-in made elsewhere", () => {
    useFeedStaleStore.getState().markStale();
    renderFeed();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useFeedStaleStore.getState().stale).toBe(false);
  });

  // The reported bug: check in, switch to the feed, and the held check-in is
  // only sent as the dashboard unmounts — after the feed was rendered.
  it("refreshes when a check-in lands after the feed rendered", () => {
    renderFeed();
    expect(refresh).not.toHaveBeenCalled();

    act(() => useFeedStaleStore.getState().markStale());

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("is not swallowed by the realtime debounce", () => {
    renderFeed();
    act(() => useFeedStaleStore.getState().markStale());
    act(() => useFeedStaleStore.getState().markStale());
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
