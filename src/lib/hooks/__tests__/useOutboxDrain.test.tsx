import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DrainResult } from "@/lib/outbox-drain";
import { useOutboxDrain } from "../useOutboxDrain";

const drainOutbox = vi.fn<() => Promise<DrainResult>>();

vi.mock("@/lib/outbox-drain", () => ({
  drainOutbox: () => drainOutbox(),
  setDrainContext: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/hooks/useAuthUserId", () => ({ useAuthUserId: () => "me" }));

function renderDrain() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  renderHook(() => useOutboxDrain(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return invalidate;
}

describe("useOutboxDrain", () => {
  beforeEach(() => {
    drainOutbox.mockReset().mockResolvedValue({ synced: 0, dropped: 0, remaining: 0 });
  });

  it("refetches the dashboard once a drain has sent something", async () => {
    // The dashboard's own refetch on reconnect may have landed first, before
    // the server had what was queued.
    drainOutbox.mockResolvedValue({ synced: 1, dropped: 0, remaining: 0 });

    const invalidate = renderDrain();

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard"] }),
    );
  });

  it("leaves the dashboard alone when there was nothing to send", async () => {
    const invalidate = renderDrain();

    await waitFor(() => expect(drainOutbox).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("drains again when the connection comes back", async () => {
    renderDrain();
    await waitFor(() => expect(drainOutbox).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(drainOutbox).toHaveBeenCalledTimes(2);
  });
});
