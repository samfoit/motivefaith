import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { useQuickCaptureStore } from "@/lib/stores/quick-capture-store";
import { QuickCaptureFlow } from "../QuickCaptureFlow";

const upload = vi.fn();
const share = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    storage: { from: () => ({ upload }) },
  }),
}));
vi.mock("@/lib/supabase/rpc", () => ({
  untypedRpc: async () => ({
    data: [
      { id: "h1", title: "Pray", emoji: "🙏", color: null, streak_current: 0, frequency: "daily", partner_ids: [], group_ids: [] },
      // Its check-in already shows in Bob's thread and on Prayer Circle.
      { id: "h2", title: "Fast", emoji: "🍞", color: null, streak_current: 0, frequency: "daily", partner_ids: ["f1"], group_ids: ["g1"] },
    ],
    error: null,
  }),
}));
vi.mock("@/lib/utils/compress-image", () => ({
  compressImage: async () => new Blob(["webp"], { type: "image/webp" }),
}));
vi.mock("@/lib/hooks/useAuthUserId", () => ({ useAuthUserId: () => "me" }));
vi.mock("@/lib/hooks/useShareCapture", () => ({
  useShareCapture: () => ({ mutateAsync: share }),
}));
vi.mock("@/lib/hooks/useFriends", () => ({
  useFriendsList: () => ({
    data: [
      {
        profile: { id: "f1", display_name: "Bob", username: "bob", avatar_url: null },
      },
    ],
  }),
}));
vi.mock("@/lib/hooks/useGroups", () => ({
  useGroupsList: () => ({
    data: [{ id: "g1", name: "Prayer Circle", avatar_url: null, memberCount: 3 }],
  }),
}));

// jsdom has no object URLs; the share step uses one for its thumbnail.
URL.createObjectURL = vi.fn(() => "blob:preview");
URL.revokeObjectURL = vi.fn();

function renderFlow() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <QuickCaptureFlow />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("QuickCaptureFlow share step", () => {
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    share.mockReset().mockResolvedValue({});
    useQuickCaptureStore.getState().reset();
    useQuickCaptureStore.setState({ captureMode: "photo" });
    useQuickCaptureStore
      .getState()
      .setCapturedFile(new File(["jpg"], "shot.jpg", { type: "image/jpeg" }));
  });

  it("can't send until something is picked", async () => {
    renderFlow();
    await screen.findByText("Pray");
    expect(screen.getByRole("button", { name: /Pick where to send it/ })).toBeDisabled();
  });

  it("uploads once and sends to a habit, a friend and a group together", async () => {
    renderFlow();

    await userEvent.click(await screen.findByText("Pray"));
    await userEvent.click(screen.getByText("Bob"));
    await userEvent.click(screen.getByText("Prayer Circle"));
    await userEvent.type(screen.getByPlaceholderText(/Add a caption/), "morning");
    await userEvent.click(screen.getByRole("button", { name: /Send to 3/ }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(1);

    const [path] = upload.mock.calls[0];
    expect(path).toMatch(/^me\/capture\/[0-9a-f-]+\.webp$/);
    expect(share).toHaveBeenCalledWith({
      mediaPath: path,
      mediaType: "photo",
      caption: "morning",
      habitIds: ["h1"],
      friendIds: ["f1"],
      groupIds: ["g1"],
    });
    expect(useQuickCaptureStore.getState().step).toBe("closed");
  });

  it("keeps the selection when the send fails", async () => {
    share.mockRejectedValueOnce(new Error("boom"));
    renderFlow();

    await userEvent.click(await screen.findByText("Pray"));
    await userEvent.click(screen.getByRole("button", { name: /Send to 1/ }));

    await waitFor(() => expect(useQuickCaptureStore.getState().step).toBe("share"));
    expect(useQuickCaptureStore.getState().habitIds).toEqual(["h1"]);
  });

  it("back returns to the preview with the take, caption and picks intact", async () => {
    renderFlow();

    await userEvent.click(await screen.findByText("Pray"));
    await userEvent.type(screen.getByPlaceholderText(/Add a caption/), "morning");
    const file = useQuickCaptureStore.getState().capturedFile;

    await userEvent.click(screen.getByRole("button", { name: "Back to preview" }));

    const state = useQuickCaptureStore.getState();
    expect(state.step).toBe("camera");
    expect(state.capturedFile).toBe(file);
    expect(state.habitIds).toEqual(["h1"]);
    // The camera (mocked by next/dynamic as a div) is handed the earlier take.
    expect(screen.getByTestId("dynamic-component")).toBeInTheDocument();
  });

  it("doesn't double send to who a picked habit already reaches", async () => {
    renderFlow();

    // Picked by hand first, then taken over by the habit.
    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.click(screen.getByText("Prayer Circle"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Fast" }));

    expect(useQuickCaptureStore.getState().friendIds).toEqual([]);
    expect(useQuickCaptureStore.getState().groupIds).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: /Send to 1/ }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ habitIds: ["h2"], friendIds: [], groupIds: [] }),
    );
  });
});
