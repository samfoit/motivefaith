import React, { Suspense } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CompletionForm } from "../CompletionForm";

/**
 * The global setup replaces `next/dynamic` with an inert placeholder. The
 * camera is the real one here: its review is where a photo is checked in.
 */
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) =>
    React.lazy(() => loader().then((C) => ({ default: C }))),
}));

const upload = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    storage: { from: () => ({ upload }) },
  }),
}));
vi.mock("@/lib/utils/compress-image", () => ({
  compressImage: async () => new Blob(["webp"], { type: "image/webp" }),
}));

const photo = (name = "run.jpg") => new File(["jpg"], name, { type: "image/jpeg" });

function renderSheet() {
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <Suspense fallback={null}>
      <CompletionForm
        open
        onOpenChange={onOpenChange}
        habitId="habit-1"
        habitTitle="Morning Run"
        habitEmoji="🏃"
        onComplete={onComplete}
      />
    </Suspense>,
  );
  return { ...view, onComplete, onOpenChange };
}

/** What the sheet's own picker hands back: the camera's has its own input. */
async function pick(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="file"][accept^="image/jpeg"]',
  )!;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

const submit = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  });

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null });
  URL.createObjectURL = vi.fn(() => "blob:take");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.unstubAllGlobals();
});

/**
 * A camera, a microphone and a recorder that takes every type, as Chrome's
 * does: it records "video/webm;codecs=vp9" and "audio/webm;codecs=opus".
 */
function installRecorder() {
  const track = (kind: "video" | "audio") => ({ kind, stop: vi.fn() });
  const tracks = [track("video"), track("audio")];
  const stream = {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  vi.stubGlobal(
    "MediaRecorder",
    class {
      static isTypeSupported = () => true;
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["take"]) });
        this.onstop?.();
      }
    },
  );
}

/** From the sheet's Voice tile to the review of a recorded note. */
async function recordVoiceNote() {
  fireEvent.click(screen.getByRole("button", { name: /Voice/ }));
  const start = await screen.findByRole("button", { name: "Start recording" });
  await act(async () => {
    fireEvent.click(start);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  });
}

const useRecording = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Use Recording" }));
  });

describe("CompletionForm content check-in", () => {
  it("checks in from the preview, with its caption and the private switch", async () => {
    // No camera here, so Content goes straight to the picker.
    const { container, onComplete, onOpenChange } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Content/ }));
    await pick(container, photo());

    expect(await screen.findByAltText("Captured photo")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Add a caption..."), {
      target: { value: "5k before work" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Share check-in only" }));
    await submit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const [path] = upload.mock.calls[0];
    expect(path).toMatch(/^me\/private\/.+\.webp$/);
    expect(onComplete).toHaveBeenCalledWith({
      type: "photo",
      evidenceUrl: path,
      notes: "5k before work",
      isPrivate: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays on the preview with the reason when the upload fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    upload.mockResolvedValueOnce({ error: { message: "network" } });
    const { container, onComplete } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Content/ }));
    await pick(container, photo());
    await screen.findByAltText("Captured photo");
    fireEvent.change(screen.getByPlaceholderText("Add a caption..."), {
      target: { value: "5k" },
    });

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Upload failed. Please try again.",
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("5k")).toBeInTheDocument();

    await submit();
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ type: "photo", notes: "5k", isPrivate: false }),
    );
    consoleError.mockRestore();
  });

  it("reviews each file picked in place of a denied camera, and forgets it on close", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(denied) },
    });
    const { container } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: /Content/ }));
    expect(await screen.findByText("Camera Access Denied")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use File Picker Instead" }));
    const first = photo("first.jpg");
    await pick(container, first);
    expect(await screen.findByAltText("Captured photo")).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenLastCalledWith(first);

    // A retake tries the camera again, and the next pick is reviewed in turn.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retake" }));
    });
    expect(screen.getByText("Camera Access Denied")).toBeInTheDocument();
    const second = photo("second.jpg");
    await pick(container, second);
    expect(await screen.findByAltText("Captured photo")).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenLastCalledWith(second);

    // Closed, the camera opens on itself next time, not on the old pick.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard and retake" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: /Content/ }));
    expect(await screen.findByText("Camera Access Denied")).toBeInTheDocument();
    expect(screen.queryByAltText("Captured photo")).not.toBeInTheDocument();
  });
});

/**
 * Like the camera's, the recorder's review is the last step: a voice note
 * uploads with it still up, and stays on it when that fails.
 */
describe("CompletionForm voice check-in", () => {
  it("keeps the voice note on its review when the upload fails, and sends it from there", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    installRecorder();
    upload.mockResolvedValueOnce({ error: { message: "network" } });
    const { onComplete } = renderSheet();
    await recordVoiceNote();

    await useRecording();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Upload failed. Please try again.",
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use Recording" })).toBeInTheDocument();

    await useRecording();
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ type: "voice" }));
    consoleError.mockRestore();
  });

  it("doesn't carry the reason over to a note recorded again", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    installRecorder();
    upload.mockResolvedValueOnce({ error: { message: "network" } });
    renderSheet();
    await recordVoiceNote();
    await useRecording();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retake" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    });

    expect(screen.getByRole("button", { name: "Use Recording" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("covers the review while the note uploads, and sends it once", async () => {
    installRecorder();
    let finish!: (result: { error: null }) => void;
    upload.mockImplementationOnce(
      () => new Promise((resolve) => void (finish = resolve)),
    );
    const { onComplete } = renderSheet();
    await recordVoiceNote();

    // Both taps land before React has drawn the overlay over the button.
    const use = screen.getByRole("button", { name: "Use Recording" });
    act(() => {
      fireEvent.click(use);
      fireEvent.click(use);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Uploading…");
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await act(async () => finish({ error: null }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
