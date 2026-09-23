import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  // React Query keeps its own connectivity state; the mutation's networkMode
  // is evaluated against this, not against navigator.onLine.
  onlineManager.setOnline(online);
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.resetModules();
  rpc.mockReset();
});

afterEach(() => {
  setOnline(true);
});

describe("useCompleteHabit — offline", () => {
  /**
   * Regression test for the bug where a completion logged offline was
   * silently lost.
   *
   * React Query's default mutation networkMode ("online") parks a mutation
   * without ever calling mutationFn while offline. Because every offline path
   * in this hook lives inside mutationFn, the completion was neither sent nor
   * queued — while the dashboard's own optimistic state still showed the habit
   * as complete, so nothing surfaced the loss until a reload.
   */
  it("writes the completion to IndexedDB instead of dropping it", async () => {
    setOnline(false);
    const { useCompleteHabit } = await import("../useCompleteHabit");
    const { getPendingCount } = await import("@/lib/offline-queue");

    const { result } = renderHook(() => useCompleteHabit(), { wrapper });
    result.current.mutate({ habitId: "h1", type: "quick" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ queued: true });
    expect(await getPendingCount()).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("queues a rain check with its reason and moved-to day", async () => {
    setOnline(false);
    const { useCompleteHabit } = await import("../useCompleteHabit");
    const { getPendingCompletions } = await import("@/lib/offline-queue");

    const { result } = renderHook(() => useCompleteHabit(), { wrapper });
    result.current.mutate({
      habitId: "h1",
      type: "rain_check",
      rainCheckReason: "sick",
      rainCheckMovedTo: "2026-09-24",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [queued] = await getPendingCompletions();
    expect(queued).toMatchObject({
      habitId: "h1",
      type: "rain_check",
      rainCheckReason: "sick",
      rainCheckMovedTo: "2026-09-24",
    });
  });

  it("queues when the request fails mid-flight despite navigator.onLine", async () => {
    setOnline(true);
    // Lie-fi: the browser reports a connection, the request dies anyway.
    rpc.mockRejectedValue(new TypeError("Failed to fetch"));

    const { useCompleteHabit } = await import("../useCompleteHabit");
    const { getPendingCount } = await import("@/lib/offline-queue");

    const { result } = renderHook(() => useCompleteHabit(), { wrapper });
    result.current.mutate({ habitId: "h1", type: "quick" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ queued: true });
    expect(await getPendingCount()).toBe(1);
  });

  it("still surfaces server errors rather than swallowing them into the queue", async () => {
    setOnline(true);
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });

    const { useCompleteHabit } = await import("../useCompleteHabit");
    const { getPendingCount } = await import("@/lib/offline-queue");

    const { result } = renderHook(() => useCompleteHabit(), { wrapper });
    result.current.mutate({ habitId: "h1", type: "quick" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(await getPendingCount()).toBe(0);
  });

  it("sends straight to the RPC when online", async () => {
    setOnline(true);
    rpc.mockResolvedValue({ data: { id: "c1" }, error: null });

    const { useCompleteHabit } = await import("../useCompleteHabit");
    const { getPendingCount } = await import("@/lib/offline-queue");

    const { result } = renderHook(() => useCompleteHabit(), { wrapper });
    result.current.mutate({ habitId: "h1", type: "quick" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpc).toHaveBeenCalledWith("insert_completion", expect.objectContaining({
      p_habit_id: "h1",
      p_completion_type: "quick",
    }));
    expect(await getPendingCount()).toBe(0);
  });
});
