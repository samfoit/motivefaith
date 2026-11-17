import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import type { CaptureSharePayload } from "@/lib/offline-write";
import { MAX_GIF_SIZE_MB } from "@/lib/constants/limits";
import { ChatComposer, type SentChatMedia } from "../ChatComposer";

const upload = vi.fn();
const share = vi.fn();
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
vi.mock("@/lib/hooks/useShareCapture", () => ({
  useShareCapture: () => ({ mutateAsync: share }),
}));

// jsdom has no object URLs; the waiting picture is shown from one.
URL.createObjectURL = vi.fn(() => "blob:preview");
URL.revokeObjectURL = vi.fn();

let onLine = true;
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });

const gif = () => new File(["GIF89a"], "party.gif", { type: "image/gif" });
const photo = () => new File(["jpeg"], "beach.jpg", { type: "image/jpeg" });

let onSendText: ReturnType<typeof vi.fn<(text: string) => Promise<boolean>>>;
let onMediaSent: ReturnType<typeof vi.fn<(sent: SentChatMedia) => void>>;

beforeEach(() => {
  onLine = true;
  upload.mockReset().mockResolvedValue({ error: null });
  share.mockReset().mockResolvedValue({
    completion_ids: [],
    encouragement_ids: ["e1"],
    group_message_ids: ["gm1"],
  });
  queueCapture.mockReset().mockResolvedValue();
  onSendText = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true);
  onMediaSent = vi.fn<(sent: SentChatMedia) => void>();
});

function renderComposer(target: { kind: "friend" | "group"; id: string } = { kind: "friend", id: "f1" }) {
  const view = render(
    <ToastProvider>
      <ChatComposer
        placeholder="Message Bob..."
        userId="me"
        target={target}
        onSendText={onSendText}
        onMediaSent={onMediaSent}
      />
    </ToastProvider>,
  );
  const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  return { ...view, fileInput };
}

const box = () => screen.getByRole("textbox");
const sendButton = () => screen.getByRole("button", { name: "Send message" });

describe("ChatComposer", () => {
  it("sends text, and clears the box", async () => {
    renderComposer();
    expect(sendButton()).toBeDisabled();

    await userEvent.type(box(), "  well done  ");
    await userEvent.click(sendButton());

    expect(onSendText).toHaveBeenCalledWith("well done");
    await waitFor(() => expect(box()).toHaveValue(""));
    expect(upload).not.toHaveBeenCalled();
  });

  it("puts the text back when it didn't send", async () => {
    onSendText.mockResolvedValue(false);
    renderComposer();

    await userEvent.type(box(), "well done");
    await userEvent.click(sendButton());

    await waitFor(() => expect(box()).toHaveValue("well done"));
  });

  it("sends a picked GIF as a GIF, with what was typed as its caption", async () => {
    const { fileInput } = renderComposer();

    await userEvent.upload(fileInput, gif());
    expect(screen.getByAltText("Picture to send")).toHaveAttribute("src", "blob:preview");
    // What's typed now goes with the picture.
    expect(box()).toHaveAttribute("placeholder", "Add a caption...");

    await userEvent.type(box(), "us on Friday");
    await userEvent.click(sendButton());

    await waitFor(() => expect(onMediaSent).toHaveBeenCalled());
    const [path, blob, options] = upload.mock.calls[0];
    expect(path).toMatch(/^me\/capture\/[0-9a-f-]{36}\.gif$/);
    expect(blob.type).toBe("image/gif");
    expect(options).toEqual({ contentType: "image/gif" });
    expect(share).toHaveBeenCalledWith({
      mediaPath: path,
      mediaType: "photo",
      caption: "us on Friday",
      habitIds: [],
      friendIds: ["f1"],
      groupIds: [],
    });
    expect(onMediaSent).toHaveBeenCalledWith({
      id: "e1",
      mediaPath: path,
      mediaType: "photo",
      caption: "us on Friday",
    });
    expect(onSendText).not.toHaveBeenCalled();
    // The bar is back to an empty message box.
    expect(screen.queryByAltText("Picture to send")).toBeNull();
    expect(box()).toHaveValue("");
    expect(box()).toHaveAttribute("placeholder", "Message Bob...");
  });

  it("sends a photo with no caption, shrunk, to a group", async () => {
    const { fileInput } = renderComposer({ kind: "group", id: "g1" });

    await userEvent.upload(fileInput, photo());
    await userEvent.click(sendButton());

    await waitFor(() => expect(onMediaSent).toHaveBeenCalled());
    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(/\.webp$/);
    expect(options).toEqual({ contentType: "image/webp" });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ caption: undefined, friendIds: [], groupIds: ["g1"] }),
    );
    expect(onMediaSent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gm1", caption: null }),
    );
  });

  it("takes a pasted picture, and leaves pasted text alone", async () => {
    renderComposer();

    fireEvent.paste(box(), { clipboardData: { files: [] } });
    expect(screen.queryByAltText("Picture to send")).toBeNull();

    fireEvent.paste(box(), { clipboardData: { files: [gif()] } });
    expect(screen.getByAltText("Picture to send")).toBeInTheDocument();
  });

  it("lets a picked picture be removed", async () => {
    const { fileInput } = renderComposer();

    await userEvent.upload(fileInput, gif());
    await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));

    expect(screen.queryByAltText("Picture to send")).toBeNull();
    expect(sendButton()).toBeDisabled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("turns away a GIF too large to send whole", async () => {
    const { fileInput } = renderComposer();
    const huge = gif();
    Object.defineProperty(huge, "size", { value: (MAX_GIF_SIZE_MB + 2) * 1024 * 1024 });

    await userEvent.upload(fileInput, huge);

    expect(
      await screen.findByText(`GIFs can be up to ${MAX_GIF_SIZE_MB} MB. This one is ${MAX_GIF_SIZE_MB + 2} MB.`),
    ).toBeInTheDocument();
    expect(screen.queryByAltText("Picture to send")).toBeNull();
  });

  it("points a picked video at the camera", async () => {
    const { fileInput } = renderComposer();
    const video = new File(["v"], "clip.mp4", { type: "video/mp4" });

    // Not userEvent.upload: it honours `accept`, as most pickers do, and the
    // case here is the picker that lets one through anyway.
    fireEvent.change(fileInput, { target: { files: [video] } });

    expect(
      await screen.findByText("Videos are sent with the camera button at the top."),
    ).toBeInTheDocument();
    expect(screen.queryByAltText("Picture to send")).toBeNull();
  });

  it("keeps the picture and its caption when the send fails", async () => {
    share.mockRejectedValue({ message: "Not friends with recipient", code: "42501" });
    const { fileInput } = renderComposer();

    await userEvent.upload(fileInput, gif());
    await userEvent.type(box(), "look");
    await userEvent.click(sendButton());

    expect(await screen.findByText("Couldn't send. Try again.")).toBeInTheDocument();
    expect(screen.getByAltText("Picture to send")).toBeInTheDocument();
    expect(box()).toHaveValue("look");
    expect(onMediaSent).not.toHaveBeenCalled();
    expect(queueCapture).not.toHaveBeenCalled();
  });

  it("keeps a picture to send later when offline", async () => {
    onLine = false;
    const { fileInput } = renderComposer();

    await userEvent.upload(fileInput, gif());
    await userEvent.click(sendButton());

    expect(await screen.findByText("It'll send when you're back online.")).toBeInTheDocument();
    expect(queueCapture).toHaveBeenCalledTimes(1);
    expect(queueCapture.mock.calls[0][0].payload).toMatchObject({
      mediaType: "photo",
      friendIds: ["f1"],
      contentType: "image/gif",
    });
    expect(upload).not.toHaveBeenCalled();
    // The chat has nothing to show yet.
    expect(onMediaSent).not.toHaveBeenCalled();
    expect(screen.queryByAltText("Picture to send")).toBeNull();
  });
});
