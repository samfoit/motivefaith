import { render, screen } from "@testing-library/react";
import { QueryClient, dehydrate, useQuery } from "@tanstack/react-query";
import {
  PersistQueryClientProvider,
  type Persister,
} from "@tanstack/react-query-persist-client";
import { describe, it, expect, vi } from "vitest";
import { markRestoredStale } from "../query-persister";

const KEY = ["dashboard", "me"];

/** What the last session left in IndexedDB: fetched just before it closed. */
function savedFromLastSession(habits: string[]): Persister {
  const last = new QueryClient();
  last.setQueryData(KEY, { habits });
  return {
    persistClient: async () => {},
    restoreClient: async () => ({
      timestamp: Date.now(),
      buster: "",
      clientState: dehydrate(last),
    }),
    removeClient: async () => {},
  };
}

function Habits({
  queryFn,
  staleTime,
}: {
  queryFn: () => Promise<{ habits: string[] }>;
  staleTime: number | "static";
}) {
  const { data } = useQuery({ queryKey: KEY, queryFn, staleTime });
  return <p>{data ? data.habits.join(", ") : "…"}</p>;
}

/** The app reopened: the saved cache restored, then the screen mounted. */
function reopen({
  onSuccess,
  staleTime = 60_000,
}: {
  onSuccess?: (client: QueryClient) => unknown;
  staleTime?: number | "static";
}) {
  const queryClient = new QueryClient();
  const queryFn = vi.fn().mockResolvedValue({ habits: ["Run", "Made on phone"] });
  render(
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: savedFromLastSession(["Run"]) }}
      onSuccess={onSuccess ? () => onSuccess(queryClient) : undefined}
    >
      <Habits queryFn={queryFn} staleTime={staleTime} />
    </PersistQueryClientProvider>,
  );
  return queryFn;
}

describe("markRestoredStale", () => {
  it("asks the server on reopening, however recently the last fetch was", async () => {
    const queryFn = reopen({ onSuccess: markRestoredStale });

    expect(await screen.findByText("Run, Made on phone")).toBeInTheDocument();
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("is what reopening needed: within the staleTime, the saved list showed unasked", async () => {
    const queryFn = reopen({});

    expect(await screen.findByText("Run")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("leaves alone what never goes stale, like a sharing yes the server has", async () => {
    const queryFn = reopen({ onSuccess: markRestoredStale, staleTime: "static" });

    expect(await screen.findByText("Run")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(queryFn).not.toHaveBeenCalled();
  });
});
