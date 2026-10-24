import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { useQuickCaptureStore } from "@/lib/stores/quick-capture-store";
import type { DashboardData } from "@/lib/data/dashboard";
import type { CaptureSharePayload } from "@/lib/offline-write";
import { QuickCaptureFlow } from "../QuickCaptureFlow";

const upload = vi.fn();
const share = vi.fn();
const rpc = vi.fn();
const queueCapture =
  vi.fn<(entry: { id: string; userId: string; payload: CaptureSharePayload }) => Promise<void>>();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload }) },
  }),
}));
vi.mock("@/lib/supabase/rpc", () => ({
  untypedRpc: (...args: unknown[]) => rpc(...args),
}));
// The real outbox needs IndexedDB; what's handed to it is what matters here.
vi.mock("@/lib/offline-write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-write")>()),
  queueCaptureShare: (entry: { id: string; userId: string; payload: CaptureSharePayload }) =>
    queueCapture(entry),
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

const HABITS = [
  { id: "h1", title: "Pray", emoji: "🙏", color: null, streak_current: 0, frequency: "daily", partner_ids: [], group_ids: [] },
  // Its check-in already shows in Bob's thread and on Prayer Circle.
  { id: "h2", title: "Fast", emoji: "🍞", color: null, streak_current: 0, frequency: "daily", partner_ids: ["f1"], group_ids: ["g1"] },
];

/** What PostgREST hands back when the request never got anywhere. */
const NO_CONNECTION = { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" };

let onLine = true;
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });

function goOffline() {
  onLine = false;
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
}

beforeEach(() => {
  onLine = true;
  rpc.mockReset().mockResolvedValue({ data: HABITS, error: null });
  queueCapture.mockReset().mockResolvedValue();
});

function renderFlow(queryClient = new QueryClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <QuickCaptureFlow />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  };
}

/** The dashboard as the persisted cache holds it: both habits daily, nothing logged. */
function withCachedDashboard(
  completions: Record<string, { id: string; completed_at: string; completion_type: "quick" }[]> = {},
) {
  const queryClient = new QueryClient();
  const habit = (id: string, title: string) => ({
    id,
    user_id: "me",
    title,
    description: null,
    emoji: null,
    color: null,
    frequency: "daily",
    schedule: null,
    time_window: null,
    streak_current: 0,
    streak_best: 0,
    total_completions: 0,
    is_paused: false,
    visibility: "private",
    private_checkins: false,
    created_at: "2026-01-01T00:00:00Z",
    completions: completions[id] ?? [],
    challenge: null,
  });
  queryClient.setQueryData(["dashboard", "me"], {
    habits: [habit("h1", "Pray"), habit("h2", "Fast")],
    timezone: "UTC",
    firstName: "Sam",
  });
  return queryClient;
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
    // Refused, not cut off: nothing is promised for later.
    expect(queueCapture).not.toHaveBeenCalled();
  });

  it("keeps the picker's list for when it can't be fetched", async () => {
    const { queryClient } = renderFlow();

    await screen.findByText("Pray");

    expect(queryClient.getQueryData(["capture-habits", "me"])).toEqual(HABITS);
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

describe("QuickCaptureFlow offline", () => {
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    share.mockReset().mockResolvedValue({});
    rpc.mockResolvedValue({ data: null, error: NO_CONNECTION });
    useQuickCaptureStore.getState().reset();
    useQuickCaptureStore.setState({ captureMode: "photo" });
    useQuickCaptureStore
      .getState()
      .setCapturedFile(new File(["jpg"], "shot.jpg", { type: "image/jpeg" }));
  });

  it("lists today's habits from the cached dashboard instead of failing to load them", async () => {
    goOffline();
    renderFlow(
      withCachedDashboard({
        h2: [{ id: "c1", completed_at: new Date().toISOString(), completion_type: "quick" }],
      }),
    );

    expect(await screen.findByText("Pray")).toBeInTheDocument();
    // Checked in already today.
    expect(screen.queryByText("Fast")).not.toBeInTheDocument();
    expect(screen.queryByText(/load/i)).not.toBeInTheDocument();
  });

  it("says the habits need a connection when none are cached — not that they're all done", async () => {
    goOffline();
    renderFlow();

    expect(await screen.findByText("Your habits need a connection.")).toBeInTheDocument();
    expect(screen.queryByText("All done for today!")).not.toBeInTheDocument();
    // Friends and groups come from their own cache, and can still be picked.
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("still locks in who a habit already reaches, from the last list it fetched", async () => {
    goOffline();
    const queryClient = withCachedDashboard();
    queryClient.setQueryData(["capture-habits", "me"], HABITS);
    renderFlow(queryClient);

    await userEvent.click(await screen.findByText("Bob"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Fast" }));

    expect(useQuickCaptureStore.getState().friendIds).toEqual([]);
  });

  it("keeps the take to send once back online, checking the habit in meanwhile", async () => {
    goOffline();
    const { queryClient } = renderFlow(withCachedDashboard());

    await userEvent.click(await screen.findByText("Pray"));
    await userEvent.click(screen.getByText("Bob"));
    await userEvent.type(screen.getByPlaceholderText(/Add a caption/), "morning");
    await userEvent.click(screen.getByRole("button", { name: "Send to 2 when online" }));

    await waitFor(() => expect(queueCapture).toHaveBeenCalledTimes(1));
    expect(upload).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();

    const { id, userId, payload } = queueCapture.mock.calls[0][0];
    expect(userId).toBe("me");
    expect(payload).toEqual({
      mediaPath: `me/capture/${id}.webp`,
      mediaType: "photo",
      caption: "morning",
      habitIds: ["h1"],
      friendIds: ["f1"],
      groupIds: [],
      isPrivate: false,
      contentType: "image/webp",
      media: expect.anything(),
    });
    // The compressed photo, not the original.
    expect(new TextDecoder().decode(payload.media)).toBe("webp");

    expect(useQuickCaptureStore.getState().step).toBe("closed");
    expect(await screen.findByText("It'll send when you're back online.")).toBeInTheDocument();

    const dashboard = queryClient.getQueryData<DashboardData>(["dashboard", "me"]);
    expect(dashboard?.habits.find((h) => h.id === "h1")?.completions).toEqual([
      expect.objectContaining({ completion_type: "photo" }),
    ]);
  });

  it("keeps a take whose connection drops partway, under the path it was going up to", async () => {
    rpc.mockResolvedValue({ data: HABITS, error: null });
    // Online by navigator.onLine, but the upload never arrives.
    upload.mockResolvedValue({
      error: {
        name: "StorageUnknownError",
        message: "Failed to fetch",
        originalError: new TypeError("Failed to fetch"),
      },
    });
    renderFlow();

    await userEvent.click(await screen.findByText("Pray"));
    await userEvent.click(screen.getByRole("button", { name: "Send to 1" }));

    await waitFor(() => expect(queueCapture).toHaveBeenCalledTimes(1));
    const [path] = upload.mock.calls[0];
    expect(queueCapture.mock.calls[0][0].payload.mediaPath).toBe(path);
    expect(share).not.toHaveBeenCalled();
    expect(useQuickCaptureStore.getState().step).toBe("closed");
  });

  it("keeps the take on screen when it can't even be stored", async () => {
    goOffline();
    queueCapture.mockRejectedValue(new DOMException("Quota exceeded", "QuotaExceededError"));
    renderFlow(withCachedDashboard());

    await userEvent.click(await screen.findByText("Pray"));
    await userEvent.click(screen.getByRole("button", { name: /Send to 1/ }));

    expect(await screen.findAllByText("Couldn't send. Try again.")).not.toHaveLength(0);
    expect(useQuickCaptureStore.getState().step).toBe("share");
    expect(useQuickCaptureStore.getState().capturedFile).not.toBeNull();
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

  it("offline, keeps the take for that chat and says so, without refreshing it", async () => {
    goOffline();
    const onSent = vi.fn();
    useQuickCaptureStore.getState().openTo({ kind: "friend", id: "f1", name: "Bob", onSent });
    const { container } = renderFlow();

    takePhoto(container);

    await waitFor(() => expect(queueCapture).toHaveBeenCalledTimes(1));
    expect(queueCapture.mock.calls[0][0].payload).toEqual(
      expect.objectContaining({ habitIds: [], friendIds: ["f1"], groupIds: [] }),
    );
    expect(upload).not.toHaveBeenCalled();
    // The refresh would fetch a chat that doesn't have it yet — and fails offline.
    expect(onSent).not.toHaveBeenCalled();
    expect(useQuickCaptureStore.getState().step).toBe("closed");
    // The chat can't show it yet, so here it is said.
    expect(await screen.findByText("It'll send when you're back online.")).toBeInTheDocument();
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
