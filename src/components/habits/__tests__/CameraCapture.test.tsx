import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { CameraCapture, type CameraCaptureProps } from "../CameraCapture";
import { TranscodeError, type TranscodeOptions } from "@/lib/utils/transcode-video";

// What a picked video is measured against, and how it is trimmed and shrunk,
// have tests of their own; here it is only whether the camera asks, and what
// it does with the answer.
const checkVideo = vi.fn<(file: File) => Promise<string | null>>();
const readVideoDuration = vi.fn<(file: Blob) => Promise<number | null>>();
vi.mock("@/lib/utils/check-video", () => ({
  checkVideo: (file: File) => checkVideo(file),
  readVideoDuration: (file: Blob) => readVideoDuration(file),
}));

/** Whether this "browser" can trim and shrink a picked video. */
const transcoding = { supported: false };
const transcodeVideo = vi.fn<(file: Blob, options: TranscodeOptions) => Promise<File>>();
vi.mock("@/lib/utils/transcode-video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/transcode-video")>()),
  canTranscodeVideo: () => transcoding.supported,
  transcodeVideo: (file: Blob, options: TranscodeOptions) => transcodeVideo(file, options),
}));

/**
 * A video take latches: holding the shutter opens it, and letting go leaves it
 * running so the viewfinder gestures are free. Only a tap pauses it and only
 * the check finishes it — which makes the shutter's meaning depend on where in
 * that cycle you are, so the whole cycle is pinned here.
 */

// ---------------------------------------------------------------------------
// Fake camera and recorder
// ---------------------------------------------------------------------------

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;

  state: "inactive" | "recording" | "paused" = "inactive";
  stream: FakeMediaStream;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "video/webm" }) });
    this.onstop?.();
  });
  pause = vi.fn(() => {
    this.state = "paused";
  });
  resume = vi.fn(() => {
    this.state = "recording";
  });

  constructor(stream: FakeMediaStream) {
    this.stream = stream;
    FakeMediaRecorder.instances.push(this);
  }

  static get latest() {
    return FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
  }
}

interface FakeTrack {
  kind: "video" | "audio";
  label: string;
  stop: ReturnType<typeof vi.fn>;
  applyConstraints: ReturnType<typeof vi.fn>;
}

function fakeTrack(kind: "video" | "audio", label: string): FakeTrack {
  return { kind, label, stop: vi.fn(), applyConstraints: vi.fn().mockResolvedValue(undefined) };
}

/** jsdom has no MediaStream, and both the swap and the canvas build one. */
class FakeMediaStream {
  tracks: FakeTrack[] = [];
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

function streamOf(tracks: FakeTrack[]) {
  const s = new FakeMediaStream();
  tracks.forEach((t) => s.addTrack(t));
  return s as unknown as MediaStream;
}

const microphone = () => fakeTrack("audio", "mic");

/** A fresh camera stream per call, so a swap can be told from the original. */
function installCamera() {
  let call = 0;
  const audio = microphone();
  const getUserMedia = vi.fn(async () => {
    call += 1;
    // The first request carries the microphone; a mid-take swap is video-only.
    return call === 1
      ? streamOf([fakeTrack("video", "camera-1"), audio])
      : streamOf([fakeTrack("video", `camera-${call}`)]);
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return { getUserMedia, audio };
}

/**
 * Stand in for the offscreen canvas the take is recorded through. jsdom has no
 * 2D context and no captureStream, and without both the component records the
 * camera track directly and the flip is correctly withheld.
 */
function installCanvas() {
  const canvasTrack = fakeTrack("video", "canvas");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement["getContext"];
  (
    HTMLCanvasElement.prototype as HTMLCanvasElement & { captureStream: () => MediaStream }
  ).captureStream = () => streamOf([canvasTrack]);
  return canvasTrack;
}

/** Press and release the shutter, holding it for `holdMs` first. */
async function pressShutter(holdMs: number) {
  const shutter = screen.getByRole("button", { name: /photo|pause|resume/i });
  await act(async () => {
    fireEvent.pointerDown(shutter, { pointerId: 1, clientX: 100, clientY: 600 });
    vi.advanceTimersByTime(holdMs);
  });
  await act(async () => {
    fireEvent.pointerUp(shutter, { pointerId: 1, clientX: 100, clientY: 600 });
  });
}

/** Opens a hands-free take: Video mode, then a tap of the shutter. */
async function startVideo() {
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  });
  const shutter = screen.getByRole("button", { name: /start video/i });
  await act(async () => {
    fireEvent.pointerDown(shutter, { pointerId: 1, clientX: 100, clientY: 600 });
    fireEvent.pointerUp(shutter, { pointerId: 1, clientX: 100, clientY: 600 });
  });
}

async function renderCamera() {
  const onCapture = vi.fn();
  const view = render(
    <CameraCapture onCapture={onCapture} onClose={vi.fn()} onFallback={vi.fn()} />,
  );
  // Let the mount-time getUserMedia settle.
  await act(async () => {});
  return { ...view, onCapture };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * A mouse or trackpad device — the only kind offered the framing choice.
 * Installed fresh for every test: each suite's vi.restoreAllMocks() also
 * strips the implementation off the setup file's shared matchMedia stub.
 */
function finePointer(fine: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: fine && query === "(hover: hover) and (pointer: fine)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => finePointer(false));

describe("CameraCapture video takes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    // jsdom has no blob URLs; the preview only needs a string.
    URL.createObjectURL = vi.fn(() => "blob:take");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("MediaStream", FakeMediaStream);
    installCamera();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("ends a take held open in Photo when the shutter is let go", async () => {
    await renderCamera();

    await pressShutter(400); // past the hold threshold

    expect(FakeMediaRecorder.latest.start).toHaveBeenCalled();
    expect(FakeMediaRecorder.latest.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.latest.pause).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /use video/i })).toBeInTheDocument();
  });

  it("keeps a Video take recording after the shutter is released", async () => {
    await renderCamera();

    await startVideo();

    expect(FakeMediaRecorder.latest.state).toBe("recording");
    expect(FakeMediaRecorder.latest.stop).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeInTheDocument();
  });

  it("pauses on the next tap and picks up again on the one after", async () => {
    await renderCamera();
    await startVideo();

    await pressShutter(50);
    expect(FakeMediaRecorder.latest.pause).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.latest.state).toBe("paused");
    expect(screen.getByText(/Paused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeInTheDocument();

    await pressShutter(50);
    expect(FakeMediaRecorder.latest.resume).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.latest.state).toBe("recording");
  });

  it("does not pause on the release of the press that opened the take", async () => {
    await renderCamera();

    await startVideo();

    expect(FakeMediaRecorder.latest.pause).not.toHaveBeenCalled();
  });

  it("counts only the time actually recorded against the limit", async () => {
    await renderCamera();
    await startVideo();

    await act(async () => void vi.advanceTimersByTime(3000));
    expect(screen.getByText("00:03")).toBeInTheDocument();

    await pressShutter(50); // pause
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText("00:03")).toBeInTheDocument();

    await pressShutter(50); // keep going
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("00:05")).toBeInTheDocument();
  });

  it("finishes on the check, from a paused take too", async () => {
    await renderCamera();
    await startVideo();
    await pressShutter(50); // pause

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /finish video/i }));
    });

    expect(FakeMediaRecorder.latest.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /use video/i })).toBeInTheDocument();
  });

  it("stops itself once the take reaches the limit", async () => {
    await renderCamera();
    await startVideo();

    await act(async () => void vi.advanceTimersByTime(15_000));

    expect(FakeMediaRecorder.latest.stop).toHaveBeenCalledTimes(1);
  });

  it("opens on Photo, where a tap takes a picture rather than a video", async () => {
    await renderCamera();

    expect(screen.getByRole("radio", { name: "Photo" })).toHaveAttribute("aria-checked", "true");
    await pressShutter(50);

    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("starts a take on a tap in Video, with no hold", async () => {
    await renderCamera();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Video" }));
    });

    const shutter = screen.getByRole("button", { name: /start video/i });
    await act(async () => {
      fireEvent.pointerDown(shutter, { pointerId: 1, clientX: 100, clientY: 600 });
      fireEvent.pointerUp(shutter, { pointerId: 1, clientX: 100, clientY: 600 });
    });

    expect(FakeMediaRecorder.latest.start).toHaveBeenCalled();
    expect(FakeMediaRecorder.latest.pause).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeInTheDocument();
  });

  it("ends the take on a tap where the recorder cannot pause", async () => {
    // Safari before 14.1 exposes no pause().
    await renderCamera();
    await startVideo();

    const recorder = FakeMediaRecorder.latest;
    (recorder as { pause?: unknown }).pause = undefined;

    await pressShutter(50);

    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });
});

describe("CameraCapture retake", () => {
  let camera: ReturnType<typeof installCamera>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    URL.createObjectURL = vi.fn(() => "blob:take");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("MediaStream", FakeMediaStream);
    camera = installCamera();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("reopens the camera the take was made on", async () => {
    await renderCamera();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /switch camera/i }));
    });

    await startVideo();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /finish video/i }));
    });

    camera.getUserMedia.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retake" }));
    });

    expect(camera.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: { facingMode: { ideal: "user" } } }),
    );
  });

  it("reopens on the review of an earlier take without starting the camera", async () => {
    const file = new File(["jpg"], "shot.jpg", { type: "image/jpeg" });
    const onCapture = vi.fn();
    render(
      <CameraCapture
        onCapture={onCapture}
        onClose={vi.fn()}
        onFallback={vi.fn()}
        initialCapture={{ file, notes: "sunrise" }}
      />,
    );
    await act(async () => {});

    expect(camera.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByAltText("Captured photo")).toBeInTheDocument();
    expect(screen.getByDisplayValue("sunrise")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use Photo" }));
    });
    expect(onCapture).toHaveBeenCalledWith(file, "sunrise");
  });

  it("shows a live preview of the reopened take under Strict Mode", async () => {
    let n = 0;
    const revoked = new Set<string>();
    URL.createObjectURL = vi.fn(() => `blob:take-${++n}`);
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.add(url));

    render(
      <StrictMode>
        <CameraCapture
          onCapture={vi.fn()}
          onClose={vi.fn()}
          onFallback={vi.fn()}
          initialCapture={{ file: new File(["jpg"], "shot.jpg", { type: "image/jpeg" }) }}
        />
      </StrictMode>,
    );
    await act(async () => {});

    const src = screen.getByAltText("Captured photo").getAttribute("src")!;
    expect(revoked.has(src)).toBe(false);
  });

  it("discards a take with the review's close button and goes back to the camera", async () => {
    const onClose = vi.fn();
    render(
      <CameraCapture
        onCapture={vi.fn()}
        onClose={onClose}
        onFallback={vi.fn()}
        initialCapture={{ file: new File(["jpg"], "shot.jpg", { type: "image/jpeg" }) }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard and retake" }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText("Captured photo")).not.toBeInTheDocument();
  });
});

/**
 * A habit's check-in is sent from the review itself, so the review is the
 * last step: it carries the private switch, stays up while the take uploads,
 * and is still there, caption and all, when that fails.
 */
describe("CameraCapture sending from the review", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:take");
    URL.revokeObjectURL = vi.fn();
    installCamera();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  async function renderReview(props: Partial<CameraCaptureProps> = {}) {
    render(
      <CameraCapture
        onCapture={vi.fn()}
        onClose={vi.fn()}
        onFallback={vi.fn()}
        initialCapture={{ file: new File(["jpg"], "shot.jpg", { type: "image/jpeg" }) }}
        useLabel="Submit"
        {...props}
      />,
    );
    await act(async () => {});
  }

  it("offers the private switch when asked, and hands a change up", async () => {
    const onChange = vi.fn();
    await renderReview({ privacy: { isPrivate: false, onChange } });

    const toggle = screen.getByRole("switch", { name: "Share check-in only" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("offers no private switch where it isn't asked for", async () => {
    await renderReview();

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("covers the review while the take uploads, and sends it once", async () => {
    let finish!: () => void;
    const onCapture = vi.fn(
      () => new Promise<void>((resolve) => void (finish = resolve)),
    );
    await renderReview({ onCapture });

    // Both taps land before React has drawn the overlay over the button.
    const submit = screen.getByRole("button", { name: "Submit" });
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Uploading…");

    await act(async () => finish());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("brings the review back with the reason when sending fails", async () => {
    const onCapture = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upload failed. Please try again."))
      .mockResolvedValueOnce(undefined);
    await renderReview({ onCapture });
    fireEvent.change(screen.getByPlaceholderText("Add a caption..."), {
      target: { value: "sunrise" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByAltText("Captured photo")).toBeInTheDocument();
    expect(screen.getByDisplayValue("sunrise")).toBeInTheDocument();

    // Sent again from the same review, the reason goes.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });
    expect(onCapture).toHaveBeenCalledTimes(2);
    expect(onCapture).toHaveBeenLastCalledWith(expect.any(File), "sunrise");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reviews a take where there is no camera, and says so only on a retake", async () => {
    Reflect.deleteProperty(navigator, "mediaDevices");
    await renderReview();

    expect(screen.queryByText("Camera Unavailable")).not.toBeInTheDocument();
    expect(screen.getByAltText("Captured photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retake" }));
    });
    expect(screen.getByText("Camera Unavailable")).toBeInTheDocument();
  });
});

/**
 * Flipping mid-take works because the recorder is bound to the offscreen
 * canvas rather than the camera, so the camera underneath can be exchanged
 * without the recorder noticing. That indirection is the whole mechanism.
 */
describe("CameraCapture mid-take flip", () => {
  let camera: ReturnType<typeof installCamera>;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    URL.createObjectURL = vi.fn(() => "blob:take");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("MediaStream", FakeMediaStream);
    camera = installCamera();
    installCanvas();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  async function flip() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /switch camera/i }));
    });
  }

  it("records the canvas paired with the microphone, not the camera track", async () => {
    await renderCamera();
    await startVideo();

    const recorded = FakeMediaRecorder.latest.stream;
    expect(recorded.getVideoTracks().map((t) => t.label)).toEqual(["canvas"]);
    expect(recorded.getAudioTracks().map((t) => t.label)).toEqual(["mic"]);
  });

  it("leaves the take running across a flip", async () => {
    await renderCamera();
    await startVideo();
    const recorder = FakeMediaRecorder.latest;

    camera.getUserMedia.mockClear();
    await flip();

    // The swap really happened...
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    // ...and the take rode through it: same recorder, never stopped.
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(recorder.pause).not.toHaveBeenCalled();
    expect(recorder.state).toBe("recording");
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it("does not disturb the microphone it is recording", async () => {
    await renderCamera();
    await startVideo();

    await flip();

    expect(camera.audio.stop).not.toHaveBeenCalled();
  });

  it("keeps the clock running across a flip", async () => {
    await renderCamera();
    await startVideo();
    await act(async () => void vi.advanceTimersByTime(2000));

    await flip();
    await act(async () => void vi.advanceTimersByTime(2000));

    expect(screen.getByText("00:04")).toBeInTheDocument();
  });

  it("offers the flip during a take but not in review", async () => {
    await renderCamera();
    await startVideo();
    expect(screen.getByRole("button", { name: /switch camera/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /finish video/i }));
    });

    expect(screen.queryByRole("button", { name: /switch camera/i })).not.toBeInTheDocument();
  });

  it("withholds the flip when the take could not be canvas-backed", async () => {
    // No 2D context: the recorder is bound straight to the camera track, and
    // swapping it would cut the take short.
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as HTMLCanvasElement["getContext"];

    await renderCamera();
    await startVideo();
    const recorder = FakeMediaRecorder.latest;
    expect(recorder.stream.getVideoTracks().map((t) => t.label)).toEqual(["camera-1"]);

    camera.getUserMedia.mockClear();
    await flip();

    // No swap was attempted, and the take carries on untouched.
    expect(camera.getUserMedia).not.toHaveBeenCalled();
    expect(recorder.state).toBe("recording");
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeInTheDocument();
  });
});

/**
 * The viewfinder shows the camera with object-fit: cover, so on a screen of a
 * different shape it trims two edges. The capture must trim the same ones —
 * what you see is what you get.
 */
describe("CameraCapture framing", () => {
  let drawImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("MediaStream", FakeMediaStream);
    URL.createObjectURL = vi.fn(() => "blob:take");
    URL.revokeObjectURL = vi.fn();
    installCamera();
    drawImage = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage,
    })) as unknown as HTMLCanvasElement["getContext"];
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) =>
      cb(new Blob(["jpg"], { type: "image/jpeg" })),
    );

    // A 4:3 webcam in a 16:9 viewfinder.
    const size = (name: string, value: number) =>
      vi.spyOn(HTMLVideoElement.prototype, name as "videoWidth", "get").mockReturnValue(value);
    size("videoWidth", 1920);
    size("videoHeight", 1440);
    size("clientWidth", 1600);
    size("clientHeight", 900);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("shows the whole frame by default on a landscape screen, and remembers a switch", async () => {
    localStorage.removeItem("camera-framing");
    finePointer(true);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    const view = await renderCamera();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fill the screen" }));
    });
    expect(screen.getByRole("button", { name: "Show the whole frame" })).toBeInTheDocument();
    expect(localStorage.getItem("camera-framing")).toBe("fill");

    // A fresh camera on the same device opens the way it was left.
    view.unmount();
    await renderCamera();
    expect(screen.getByRole("button", { name: "Show the whole frame" })).toBeInTheDocument();
    localStorage.removeItem("camera-framing");
  });

  it("always fills on a touch device, with no switch, whatever was saved", async () => {
    localStorage.setItem("camera-framing", "fit");
    finePointer(false);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(844);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(390);
    await renderCamera();

    expect(screen.queryByRole("button", { name: /Fill the screen|Show the whole frame/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Switch camera" })).toBeInTheDocument();
    localStorage.removeItem("camera-framing");
  });

  it("hides the framing switch mid-take, when the shape is already fixed", async () => {
    finePointer(true);
    await renderCamera();
    await startVideo();
    expect(screen.queryByRole("button", { name: /Fill the screen|Show the whole frame/ })).toBeNull();
  });

  it("photographs only the band the viewfinder shows", async () => {
    await renderCamera();
    await pressShutter(50);

    expect(drawImage).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement), 0, 180, 1920, 1080, 0, 0, 1920, 1080,
    );
  });

  it("records a video of the viewfinder's shape", async () => {
    await renderCamera();
    const created: HTMLCanvasElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "canvas") {
        (el as HTMLCanvasElement & { captureStream: () => MediaStream }).captureStream = () =>
          streamOf([fakeTrack("video", "canvas")]) as unknown as MediaStream;
        created.push(el as HTMLCanvasElement);
      }
      return el;
    });

    await startVideo();

    const take = created.at(-1)!;
    expect(take.width / take.height).toBeCloseTo(16 / 9, 2);
    expect(take.height).toBe(1080);
  });
});


/**
 * Voice mode is the same shutter cycle with no camera at all: the camera is
 * let go when the mode switches, and the mic is opened only for the take.
 */
describe("CameraCapture voice mode", () => {
  let camera: ReturnType<typeof installCamera>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    URL.createObjectURL = vi.fn(() => "blob:take");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("MediaStream", FakeMediaStream);
    camera = installCamera();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  async function switchToVoice() {
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Voice" }));
    });
  }

  async function tapVoiceShutter() {
    const shutter = screen.getByRole("button", { name: /start recording|pause|resume/i });
    await act(async () => {
      fireEvent.click(shutter);
    });
  }

  it("lets go of the camera and hides its controls", async () => {
    await renderCamera();
    const cameraStream = (await camera.getUserMedia.mock.results[0].value) as unknown as FakeMediaStream;

    await switchToVoice();

    for (const track of cameraStream.getTracks()) expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Voice" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: /switch camera/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gallery/i })).not.toBeInTheDocument();
  });

  it("records from the mic alone, pauses on a tap and finishes on the check", async () => {
    const { onCapture } = await renderCamera();
    await switchToVoice();
    camera.getUserMedia.mockClear();

    await tapVoiceShutter();
    expect(camera.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(FakeMediaRecorder.latest.state).toBe("recording");
    // The mode belongs to the take now.
    expect(screen.queryByRole("radio", { name: "Photo" })).not.toBeInTheDocument();

    await act(async () => void vi.advanceTimersByTime(2000));
    await tapVoiceShutter();
    expect(FakeMediaRecorder.latest.state).toBe("paused");
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(screen.getByText("00:02")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /finish recording/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use Recording" }));
    });

    const [file] = onCapture.mock.calls[0] as [File];
    expect(file.type).toBe("audio/webm");
    expect(file.name).toMatch(/^voice-\d+\.webm$/);
  });

  it("stops itself at the voice limit, not the video one", async () => {
    await renderCamera();
    await switchToVoice();
    await tapVoiceShutter();

    await act(async () => void vi.advanceTimersByTime(15_000));
    expect(FakeMediaRecorder.latest.stop).not.toHaveBeenCalled();

    await act(async () => void vi.advanceTimersByTime(105_000));
    expect(FakeMediaRecorder.latest.stop).toHaveBeenCalledTimes(1);
  });

  it("retakes in voice mode without turning the camera back on", async () => {
    await renderCamera();
    await switchToVoice();
    await tapVoiceShutter();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /finish recording/i }));
    });

    camera.getUserMedia.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retake" }));
    });

    expect(camera.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
  });

  it("reopens on the review of an earlier voice note, still in voice mode", async () => {
    const file = new File(["ogg"], "voice.webm", { type: "audio/webm" });
    render(
      <CameraCapture
        onCapture={vi.fn()}
        onClose={vi.fn()}
        onFallback={vi.fn()}
        initialCapture={{ file }}
      />,
    );
    await act(async () => {});
    expect(camera.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use Recording" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard and retake" }));
    });
    expect(camera.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Voice" })).toHaveAttribute("aria-checked", "true");
  });

  it("explains a denied mic instead of recording", async () => {
    await renderCamera();
    await switchToVoice();
    camera.getUserMedia.mockRejectedValueOnce(new Error("NotAllowedError"));

    await tapVoiceShutter();

    expect(screen.getByText("Microphone Access Denied")).toBeInTheDocument();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("offers a voice note when there is no camera", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    camera.getUserMedia.mockRejectedValueOnce(err);
    await renderCamera();
    expect(screen.getByText("Camera Access Denied")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /voice note instead/i }));
    });

    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
  });

  it("offers no voice mode where voice has its own way in", async () => {
    render(
      <CameraCapture
        onCapture={vi.fn()}
        onClose={vi.fn()}
        onFallback={vi.fn()}
        allowVoice={false}
      />,
    );
    await act(async () => {});

    expect(screen.queryByRole("radio", { name: "Voice" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Video" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Photo" })).toHaveAttribute("aria-checked", "true");
  });

  it("offers no voice note on a denied camera when voice is off", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    camera.getUserMedia.mockRejectedValueOnce(err);
    render(
      <CameraCapture
        onCapture={vi.fn()}
        onClose={vi.fn()}
        onFallback={vi.fn()}
        allowVoice={false}
      />,
    );
    await act(async () => {});

    expect(screen.getByText("Camera Access Denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /voice note instead/i })).not.toBeInTheDocument();
  });
});

describe("CameraCapture first-opens tip and mode swipes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    URL.createObjectURL = vi.fn(() => "blob:take");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("MediaStream", FakeMediaStream);
    installCamera();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  const tip = () => screen.getByText("Hold for video, double-tap to flip");

  it("shows the gesture tip on the first few opens only, and lets it fade", async () => {
    for (let open = 1; open <= 3; open++) {
      const { unmount } = await renderCamera();
      expect(tip()).toHaveClass("opacity-100");
      await act(async () => void vi.advanceTimersByTime(4000));
      expect(tip()).toHaveClass("opacity-0");
      unmount();
    }

    await renderCamera();
    expect(tip()).toHaveClass("opacity-0");
  });

  it("changes mode on a sideways swipe of the viewfinder", async () => {
    const { container } = await renderCamera();
    const surface = container.querySelector("video")!.parentElement!;
    const swipe = async (fromX: number, toX: number) => {
      await act(async () => {
        fireEvent.pointerDown(surface, { pointerId: 2, clientX: fromX, clientY: 300, timeStamp: 0 });
        fireEvent.pointerMove(surface, { pointerId: 2, clientX: toX, clientY: 305, timeStamp: 100 });
        fireEvent.pointerUp(surface, { pointerId: 2, clientX: toX, clientY: 305, timeStamp: 150 });
      });
    };

    await swipe(300, 100);
    expect(screen.getByRole("radio", { name: "Voice" })).toHaveAttribute("aria-checked", "true");

    const voiceSurface = screen.getByText("Tap the button to record").closest("div.relative")!;
    await act(async () => {
      fireEvent.pointerDown(voiceSurface, { pointerId: 3, clientX: 100, clientY: 300, timeStamp: 0 });
      fireEvent.pointerMove(voiceSurface, { pointerId: 3, clientX: 300, clientY: 305, timeStamp: 100 });
      fireEvent.pointerUp(voiceSurface, { pointerId: 3, clientX: 300, clientY: 305, timeStamp: 150 });
    });
    expect(screen.getByRole("radio", { name: "Photo" })).toHaveAttribute("aria-checked", "true");

    await swipe(100, 300);
    expect(screen.getByRole("radio", { name: "Video" })).toHaveAttribute("aria-checked", "true");
  });
});

/**
 * The camera stops its own takes at the limit, but a video picked from the
 * gallery can be any length or size. Where the phone can't trim and shrink it,
 * it is sent as it is, and the bucket would refuse an oversized one only after
 * all of it had been uploaded. So there it is checked as it is picked, and
 * turned away with the reason.
 */
describe("CameraCapture gallery pick, where a video can't be prepared", () => {
  const TOO_LONG = "Videos can be up to 15 seconds. This one is 42.";

  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:picked");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("MediaStream", FakeMediaStream);
    installCamera();
    transcoding.supported = false;
    checkVideo.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  async function pick(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  }

  const movie = (name = "IMG_0001.MOV") =>
    new File(["mov"], name, { type: "video/quicktime" });

  it("turns away a video that can't be sent, says why, and stays on the camera", async () => {
    checkVideo.mockResolvedValue(TOO_LONG);
    const { container, onCapture } = await renderCamera();
    const video = movie();

    await pick(container, video);

    expect(checkVideo).toHaveBeenCalledWith(video);
    expect(screen.getByRole("alert")).toHaveTextContent(TOO_LONG);
    expect(screen.queryByRole("button", { name: "Use Video" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick from gallery" })).toBeInTheDocument();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("lets the reason fade after a few seconds", async () => {
    checkVideo.mockResolvedValue(TOO_LONG);
    const { container } = await renderCamera();

    await pick(container, movie());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await act(async () => void vi.advanceTimersByTime(6000));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("takes a video that fits to its review, and from there to the caller", async () => {
    const { container, onCapture } = await renderCamera();
    const video = movie();

    await pick(container, video);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use Video" }));
    });

    expect(onCapture).toHaveBeenCalledWith(video, undefined);
  });

  it("clears the reason once a video that fits is picked", async () => {
    checkVideo.mockResolvedValueOnce(TOO_LONG).mockResolvedValueOnce(null);
    const { container } = await renderCamera();

    await pick(container, movie("long.MOV"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await pick(container, movie("trimmed.MOV"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Video" })).toBeInTheDocument();
  });

  it("leaves a photo from the gallery alone: it is shrunk before upload anyway", async () => {
    const { container } = await renderCamera();

    await pick(container, new File(["jpg"], "IMG_0002.JPG", { type: "image/jpeg" }));

    expect(checkVideo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use Photo" })).toBeInTheDocument();
  });
});

/**
 * Where the phone can, a picked video of any length goes to its review: a
 * long one with a window to choose the part to send, and either way it is
 * trimmed to that part and shrunk when it is used.
 */
describe("CameraCapture picked video, trimmed and shrunk", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:picked");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("MediaStream", FakeMediaStream);
    installCamera();
    transcoding.supported = true;
    checkVideo.mockReset().mockResolvedValue(null);
    readVideoDuration.mockReset().mockResolvedValue(42);
    transcodeVideo.mockReset();
    // jsdom plays no media; the preview is only told to play and pause.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    transcoding.supported = false;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  async function pick(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  }

  const movie = () => new File(["mov"], "IMG_0001.MOV", { type: "video/quicktime" });
  const slider = () => screen.getByRole("slider", { name: "Part of the video to send" });
  const use = () => {
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Use Video" }));
    });
  };

  /** A transcode that is told by the test how it ends. */
  function pendingTranscode() {
    let finish!: (file: File) => void;
    let fail!: (err: unknown) => void;
    transcodeVideo.mockImplementation(
      () =>
        new Promise<File>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    return {
      options: () => transcodeVideo.mock.calls[0][1],
      finish: (file: File) => act(async () => finish(file)),
      fail: (err: unknown) => act(async () => fail(err)),
    };
  }

  it("takes a video of any length to its review, offering to trim a long one", async () => {
    const { container } = await renderCamera();

    await pick(container, movie());

    expect(checkVideo).not.toHaveBeenCalled();
    expect(slider()).toHaveAttribute("aria-valuetext", "0:00 to 0:15");
    expect(screen.getByRole("button", { name: "Use Video" })).toBeInTheDocument();
  });

  it("offers no trim for a video short enough to send whole", async () => {
    readVideoDuration.mockResolvedValue(9);
    const { container } = await renderCamera();

    await pick(container, movie());

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("prepares the part chosen from the tap itself, and hands on what comes out", async () => {
    const run = pendingTranscode();
    const { container, onCapture } = await renderCamera();
    const video = movie();
    await pick(container, video);

    fireEvent.keyDown(slider(), { key: "End" });
    fireEvent.change(screen.getByPlaceholderText("Add a caption..."), {
      target: { value: "sunrise" },
    });
    use();

    // Called inside the click, with nothing awaited first.
    expect(transcodeVideo).toHaveBeenCalledWith(
      video,
      expect.objectContaining({ start: 27, length: 15 }),
    );

    await act(async () => run.options().onProgress?.(0.4));
    expect(screen.getByRole("progressbar", { name: "Preparing video" })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
    expect(onCapture).not.toHaveBeenCalled();

    const prepared = new File(["mp4"], "video-1.mp4", { type: "video/mp4" });
    await run.finish(prepared);

    expect(onCapture).toHaveBeenCalledWith(prepared, "sunrise");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("stops on Cancel and leaves the review as it was", async () => {
    const run = pendingTranscode();
    const { container, onCapture } = await renderCamera();
    await pick(container, movie());
    use();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(run.options().signal?.aborted).toBe(true);
    await run.fail(new TranscodeError("cancelled"));

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Video" })).toBeInTheDocument();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("sends a short video as it is when it can't be prepared here and fits", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    readVideoDuration.mockResolvedValue(9);
    transcodeVideo.mockRejectedValue(new TranscodeError("decode"));
    const { container, onCapture } = await renderCamera();
    const video = movie();
    await pick(container, video);

    use();
    await act(async () => {});

    expect(checkVideo).toHaveBeenCalledWith(video);
    expect(onCapture).toHaveBeenCalledWith(video, undefined);
  });

  it("says so when a long video can't be prepared, rather than send all of it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    transcodeVideo.mockRejectedValue(new TranscodeError("decode"));
    const { container, onCapture } = await renderCamera();
    await pick(container, movie());

    use();
    await act(async () => {});

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This video couldn't be prepared here. Try another, or trim it to 15 seconds first.",
    );
    expect(checkVideo).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("keeps the preview to the part chosen", async () => {
    const { container } = await renderCamera();
    await pick(container, movie());
    fireEvent.keyDown(slider(), { key: "End" });
    const preview = container.querySelector("video")!;
    expect(preview.currentTime).toBe(27);

    preview.currentTime = 42.2;
    fireEvent.timeUpdate(preview);

    expect(preview.currentTime).toBe(27);
  });

  it("doesn't prepare again a take reopened from the send screen", async () => {
    const onCapture = vi.fn();
    const prepared = new File(["mp4"], "video-1.mp4", { type: "video/mp4" });
    render(
      <CameraCapture
        onCapture={onCapture}
        onClose={vi.fn()}
        onFallback={vi.fn()}
        initialCapture={{ file: prepared }}
      />,
    );
    await act(async () => {});

    use();

    expect(transcodeVideo).not.toHaveBeenCalled();
    expect(onCapture).toHaveBeenCalledWith(prepared, undefined);
  });
});

describe("CameraCapture picked video, a double tap on Use", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:picked");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal("MediaStream", FakeMediaStream);
    installCamera();
    transcoding.supported = true;
    readVideoDuration.mockReset().mockResolvedValue(9);
    transcodeVideo.mockReset().mockReturnValue(new Promise<File>(() => {}));
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    transcoding.supported = false;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("prepares the video once", async () => {
    const { container } = await renderCamera();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["mov"], "IMG_0001.MOV", { type: "video/quicktime" })] },
      });
    });

    // Both taps land before React has drawn the overlay over the button.
    const button = screen.getByRole("button", { name: "Use Video" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(transcodeVideo).toHaveBeenCalledTimes(1);
  });
});
