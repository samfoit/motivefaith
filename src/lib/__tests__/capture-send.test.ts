import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CaptureSharePayload } from "@/lib/offline-write";
import type { ShareCaptureParams } from "@/lib/hooks/useShareCapture";
import { MAX_GIF_SIZE_MB } from "@/lib/constants/limits";
import { deliverCapture, prepareCapture } from "../capture-send";

const upload = vi.fn();
const queueCapture =
  vi.fn<(entry: { id: string; userId: string; payload: CaptureSharePayload }) => Promise<void>>();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ upload }) } }),
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

let onLine = true;
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });

beforeEach(() => {
  onLine = true;
  upload.mockReset().mockResolvedValue({ error: null });
  queueCapture.mockReset().mockResolvedValue();
});

describe("prepareCapture", () => {
  it("shrinks a photo to WebP", async () => {
    const photo = new File(["jpeg"], "a.jpg", { type: "image/jpeg" });
    const prepared = await prepareCapture(photo, "photo", "me");

    expect(prepared.contentType).toBe("image/webp");
    expect(prepared.mediaPath).toBe(`me/capture/${prepared.id}.webp`);
    expect(prepared.blob).not.toBe(photo);
  });

  it("sends a GIF as it is, so it stays animated", async () => {
    const gif = new File(["GIF89a"], "party.gif", { type: "image/gif" });
    const prepared = await prepareCapture(gif, "photo", "me");

    expect(prepared.blob).toBe(gif);
    expect(prepared.contentType).toBe("image/gif");
    expect(prepared.mediaPath).toBe(`me/capture/${prepared.id}.gif`);
  });

  it("sends a still of a GIF too large to go whole", async () => {
    const gif = new File(["GIF89a"], "huge.gif", { type: "image/gif" });
    Object.defineProperty(gif, "size", { value: MAX_GIF_SIZE_MB * 1024 * 1024 + 1 });
    const prepared = await prepareCapture(gif, "photo", "me");

    expect(prepared.contentType).toBe("image/webp");
    expect(prepared.mediaPath).toMatch(/\.webp$/);
  });

  it("keeps a recording's bare type, and a private take out of reach", async () => {
    const video = new File(["v"], "v.webm", { type: "video/webm;codecs=vp9" });
    const prepared = await prepareCapture(video, "video", "me", true);

    expect(prepared.contentType).toBe("video/webm");
    expect(prepared.mediaPath).toBe(`me/private/${prepared.id}.webm`);
  });
});

describe("deliverCapture", () => {
  const prepared = {
    id: "take-1",
    blob: new Blob(["GIF89a"], { type: "image/gif" }),
    contentType: "image/gif",
    mediaPath: "me/capture/take-1.gif",
  };
  const share: ShareCaptureParams = {
    mediaPath: prepared.mediaPath,
    mediaType: "photo",
    habitIds: [],
    friendIds: ["f1"],
    groupIds: [],
  };
  const sent = { completion_ids: [], encouragement_ids: ["e1"], group_message_ids: [] };

  it("uploads, then makes the rows", async () => {
    const shareNow = vi.fn().mockResolvedValue(sent);
    const outcome = await deliverCapture({ prepared, userId: "me", share, shareNow });

    expect(upload).toHaveBeenCalledWith("me/capture/take-1.gif", prepared.blob, {
      contentType: "image/gif",
    });
    expect(shareNow).toHaveBeenCalledWith(share);
    expect(outcome).toEqual({ queued: false, result: sent });
    expect(queueCapture).not.toHaveBeenCalled();
  });

  it("keeps it for later without trying when offline", async () => {
    onLine = false;
    const shareNow = vi.fn();
    const outcome = await deliverCapture({ prepared, userId: "me", share, shareNow });

    expect(outcome).toEqual({ queued: true });
    expect(upload).not.toHaveBeenCalled();
    expect(shareNow).not.toHaveBeenCalled();
    const entry = queueCapture.mock.calls[0][0];
    expect(entry).toMatchObject({ id: "take-1", userId: "me" });
    expect(entry.payload).toMatchObject({ ...share, contentType: "image/gif" });
    expect(new TextDecoder().decode(entry.payload.media)).toBe("GIF89a");
  });

  it("keeps it for later when the connection drops partway", async () => {
    const shareNow = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const outcome = await deliverCapture({ prepared, userId: "me", share, shareNow });

    expect(outcome).toEqual({ queued: true });
    expect(queueCapture).toHaveBeenCalledTimes(1);
  });

  it("throws what the server refuses instead of queueing it", async () => {
    upload.mockResolvedValue({ error: { statusCode: "413", message: "too large" } });
    const shareNow = vi.fn();

    await expect(
      deliverCapture({ prepared, userId: "me", share, shareNow }),
    ).rejects.toMatchObject({ statusCode: "413" });
    expect(shareNow).not.toHaveBeenCalled();
    expect(queueCapture).not.toHaveBeenCalled();
  });
});
