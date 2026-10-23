import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const checkVideo = vi.fn<(file: File) => Promise<string | null>>();
vi.mock("@/lib/utils/check-video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/check-video")>()),
  checkVideo: (file: File) => checkVideo(file),
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
      isPrivate: false,
    });
    expect(useQuickCaptureStore.getState().step).toBe("closed");
  });

  it("keeps a take private: uploads outside the shared folders, habits only", async () => {
    renderFlow();

    await userEvent.click(await screen.findByText("Pray"));
    await userEvent.click(screen.getByText("Bob"));
    // Going private takes back the friend it was about to be sent to.
    await userEvent.click(screen.getByRole("switch", { name: "Share check-in only" }));
    expect(useQuickCaptureStore.getState().friendIds).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Send to 1/ }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [path] = upload.mock.calls[0];
    expect(path).toMatch(/^me\/private\/[0-9a-f-]+\.webp$/);
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaPath: path,
        habitIds: ["h1"],
        friendIds: [],
        groupIds: [],
        isPrivate: true,
      }),
    );
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

  it("uploads a voice note as itself and sends it as 'voice'", async () => {
    useQuickCaptureStore.setState({ captureMode: "voice" });
    useQuickCaptureStore
      .getState()
      .setCapturedFile(new File(["opus"], "voice-1.webm", { type: "audio/webm" }));
    renderFlow();

    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.click(screen.getByRole("button", { name: /Send to 1/ }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(/^me\/capture\/[0-9a-f-]+\.webm$/);
    expect(options).toEqual({ contentType: "audio/webm" });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "voice", friendIds: ["f1"] }),
    );
  });

  it("uploads a recorder's codec-tagged video under its bare type", async () => {
    useQuickCaptureStore.setState({ captureMode: "video" });
    useQuickCaptureStore
      .getState()
      .setCapturedFile(new File(["v"], "capture-1.webm", { type: "video/webm;codecs=vp9" }));
    renderFlow();

    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.click(screen.getByRole("button", { name: /Send to 1/ }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(/\.webm$/);
    expect(options).toEqual({ contentType: "video/webm" });
  });

  it("says a file was too large, not to try again, when the bucket refuses its size", async () => {
    upload.mockResolvedValue({
      error: { statusCode: "413", message: "The object exceeded the maximum allowed size" },
    });
    useQuickCaptureStore.setState({ captureMode: "video" });
    useQuickCaptureStore
      .getState()
      .setCapturedFile(new File(["mov"], "IMG_0001.MOV", { type: "video/quicktime" }));
    renderFlow();

    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.click(screen.getByRole("button", { name: /Send to 1/ }));

    expect(await screen.findAllByText("That file is too large to send.")).not.toHaveLength(0);
    expect(share).not.toHaveBeenCalled();
  });
});

describe("QuickCaptureFlow file picker", () => {
  // Opened from the camera's "unavailable" screen, as the camera is mocked away.
  function pick(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    share.mockReset().mockResolvedValue({});
    checkVideo.mockReset().mockResolvedValue(null);
    useQuickCaptureStore.getState().reset();
    useQuickCaptureStore.getState().open();
  });

  it("turns away a video that can't be sent, saying why, before any upload", async () => {
    const reason = "Videos can be up to 15 seconds. This one is 42.";
    checkVideo.mockResolvedValue(reason);
    const { container } = renderFlow();
    const video = new File(["mov"], "IMG_0001.MOV", { type: "video/quicktime" });

    pick(container, video);

    expect(await screen.findAllByText(reason)).not.toHaveLength(0);
    expect(checkVideo).toHaveBeenCalledWith(video);
    expect(useQuickCaptureStore.getState().capturedFile).toBeNull();
    expect(useQuickCaptureStore.getState().step).toBe("camera");
    expect(upload).not.toHaveBeenCalled();
  });

  it("takes a video that fits on to the send screen", async () => {
    const { container } = renderFlow();
    const video = new File(["mov"], "IMG_0001.MOV", { type: "video/quicktime" });

    pick(container, video);

    await waitFor(() => expect(useQuickCaptureStore.getState().step).toBe("share"));
    expect(useQuickCaptureStore.getState().capturedFile).toBe(video);
    expect(useQuickCaptureStore.getState().captureMode).toBe("video");
  });
});

describe("QuickCaptureFlow opened from a chat", () => {
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    share.mockReset().mockResolvedValue({});
    useQuickCaptureStore.getState().reset();
  });

  // The camera is mocked away; a take from the file picker goes the same way.
  function takePhoto(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["jpg"], "shot.jpg", { type: "image/jpeg" })] },
    });
  }

  it("sends the take straight to that friend, with no picker", async () => {
    const onSent = vi.fn();
    useQuickCaptureStore.getState().openTo({ kind: "friend", id: "f1", name: "Bob", onSent });
    const { container } = renderFlow();

    takePhoto(container);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ habitIds: [], friendIds: ["f1"], groupIds: [] }),
    );
    expect(screen.queryByText("Send to…")).not.toBeInTheDocument();
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(useQuickCaptureStore.getState().step).toBe("closed");
    // The chat shows the message; no toast on top of it.
    expect(screen.queryByText(/Sent/)).not.toBeInTheDocument();
  });

  it("sends to the group it was opened from", async () => {
    useQuickCaptureStore.getState().openTo({ kind: "group", id: "g1", name: "Prayer Circle" });
    const { container } = renderFlow();

    takePhoto(container);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ habitIds: [], friendIds: [], groupIds: ["g1"] }),
    );
  });

  it("goes back to the take's preview, not the picker, when the send fails", async () => {
    share.mockRejectedValueOnce(new Error("boom"));
    useQuickCaptureStore.getState().openTo({ kind: "friend", id: "f1", name: "Bob" });
    const { container } = renderFlow();

    takePhoto(container);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useQuickCaptureStore.getState().step).toBe("camera"));
    expect(useQuickCaptureStore.getState().capturedFile).not.toBeNull();
    expect(useQuickCaptureStore.getState().direct?.id).toBe("f1");
  });
});
