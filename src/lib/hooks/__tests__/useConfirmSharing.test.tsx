import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkinSharingKey,
  type AudienceMember,
  type CheckinSharing,
} from "@/lib/data/checkin-sharing";
import { useCheckinSharingStore } from "@/lib/stores/checkin-sharing-store";
import { useConfirmSharing } from "../useConfirmSharing";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/rpc", () => ({
  untypedRpc: (_client: unknown, name: string) => rpc(name),
}));
vi.mock("@/lib/hooks/useAuthUserId", () => ({ useAuthUserId: () => "me" }));

const PAT: AudienceMember = {
  habit_id: "run",
  kind: "partner",
  id: "pat",
  name: "Pat",
  avatar_url: null,
};
const CIRCLE: AudienceMember = {
  habit_id: "run",
  kind: "group",
  id: "circle",
  name: "Circle",
  avatar_url: null,
};
/** Pat watches two habits; a check-in on both still reaches Pat once. */
const PAT_ON_PRAY: AudienceMember = { ...PAT, habit_id: "pray" };

/** What the server says, until a test says otherwise. */
let server: CheckinSharing;

/** What PostgREST hands back when the request never got anywhere. */
const NO_CONNECTION = { message: "TypeError: Failed to fetch", code: "" };

beforeEach(() => {
  server = { confirmed: false, audience: [PAT, CIRCLE, PAT_ON_PRAY] };
  rpc.mockReset().mockImplementation(async (name: string) =>
    name === "get_checkin_audience"
      ? { data: server, error: null }
      : { data: null, error: null },
  );
  useCheckinSharingStore.setState({ question: null, waiting: [] });
});

function setup(queryClient = new QueryClient()) {
  const { result } = renderHook(() => useConfirmSharing(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { confirmSharing: result.current, queryClient };
}

/** Let the hook's fetch land and the question go up. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("useConfirmSharing", () => {
  it("lets a check-in that reaches nobody straight through", async () => {
    const { confirmSharing } = setup();
    await expect(confirmSharing(["alone"])).resolves.toBe(true);
    expect(useCheckinSharingStore.getState().question).toBeNull();
  });

  it("holds the first one that reaches somebody, and names them", async () => {
    const { confirmSharing } = setup();
    const answered = confirmSharing(["run"]);
    await settle();

    expect(useCheckinSharingStore.getState().question).toEqual({
      audience: [PAT, CIRCLE],
    });

    act(() => useCheckinSharingStore.getState().answer(true));
    await expect(answered).resolves.toBe(true);
  });

  it("sends nothing when the answer is no", async () => {
    const { confirmSharing } = setup();
    const answered = confirmSharing(["run"]);
    await settle();

    act(() => useCheckinSharingStore.getState().answer(false));
    await expect(answered).resolves.toBe(false);
  });

  it("names each partner once across several habits", async () => {
    const { confirmSharing } = setup();
    void confirmSharing(["run", "pray"]);
    await settle();

    expect(useCheckinSharingStore.getState().question?.audience).toEqual([
      PAT,
      CIRCLE,
    ]);
  });

  it("never asks someone who has already said yes, without asking the server", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(checkinSharingKey("me"), {
      confirmed: true,
      audience: [],
    });
    const { confirmSharing } = setup(queryClient);

    await expect(confirmSharing(["run"])).resolves.toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("goes by the server when the yes was given on another device", async () => {
    server = { confirmed: true, audience: [] };
    const { confirmSharing } = setup();
    await expect(confirmSharing(["run"])).resolves.toBe(true);
    expect(useCheckinSharingStore.getState().question).toBeNull();
  });

  it("asks the server again for a partner who has just accepted", async () => {
    const queryClient = new QueryClient();
    // Fetched a while ago, when "run" had nobody on it.
    queryClient.setQueryData(
      checkinSharingKey("me"),
      { confirmed: false, audience: [] },
      { updatedAt: Date.now() - 60_000 },
    );
    const { confirmSharing } = setup(queryClient);

    void confirmSharing(["run"]);
    await settle();

    expect(useCheckinSharingStore.getState().question?.audience).toEqual([
      PAT,
      CIRCLE,
    ]);
  });

  describe("offline", () => {
    beforeEach(() => {
      rpc.mockResolvedValue({ data: null, error: NO_CONNECTION });
    });

    it("goes by who each habit reached when last online", async () => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(
        checkinSharingKey("me"),
        { confirmed: false, audience: [PAT] },
        { updatedAt: Date.now() - 60_000 },
      );
      const { confirmSharing } = setup(queryClient);

      await expect(confirmSharing(["alone"])).resolves.toBe(true);

      void confirmSharing(["run"]);
      await settle();
      expect(useCheckinSharingStore.getState().question?.audience).toEqual([
        PAT,
      ]);
    });

    it("asks without names when it has never been told", async () => {
      const { confirmSharing } = setup();
      void confirmSharing(["alone"]);
      await settle();

      // Not knowing is not the same as reaching nobody.
      expect(useCheckinSharingStore.getState().question).toEqual({
        audience: null,
      });
    });
  });

  it("asks once for two check-ins started together", async () => {
    const { confirmSharing } = setup();
    const first = confirmSharing(["run"]);
    const second = confirmSharing(["pray"]);
    await settle();

    // The first one's question stays up; the second waits on its answer.
    expect(useCheckinSharingStore.getState().question?.audience).toEqual([
      PAT,
      CIRCLE,
    ]);
    act(() => useCheckinSharingStore.getState().answer(true));
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it("treats an answer it can't read as no answer, and asks", async () => {
    rpc.mockResolvedValue({ data: [{ id: "h1" }], error: null });
    const { confirmSharing } = setup();
    void confirmSharing(["alone"]);
    await settle();

    expect(useCheckinSharingStore.getState().question).toEqual({
      audience: null,
    });
  });
});
