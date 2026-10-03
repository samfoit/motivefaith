import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { CameraCapture } from "../CameraCapture";

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

  it("keeps recording after the shutter is released", async () => {
    await renderCamera();

    await pressShutter(400); // past the hold threshold

    expect(FakeMediaRecorder.latest.start).toHaveBeenCalled();
    expect(FakeMediaRecorder.latest.state).toBe("recording");
    expect(FakeMediaRecorder.latest.stop).not.toHaveBeenCalled();
    expect(screen.getByText(/Tap to pause/)).toBeInTheDocument();
  });

  it("pauses on the next tap and picks up again on the one after", async () => {
    await renderCamera();
    await pressShutter(400);

    await pressShutter(50);
    expect(FakeMediaRecorder.latest.pause).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.latest.state).toBe("paused");
    expect(screen.getByText(/Paused/)).toBeInTheDocument();
    expect(screen.getByText(/Tap to keep going/)).toBeInTheDocument();

    await pressShutter(50);
    expect(FakeMediaRecorder.latest.resume).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.latest.state).toBe("recording");
  });

  it("does not pause on the release of the press that opened the take", async () => {
    await renderCamera();

    await pressShutter(400);

    expect(FakeMediaRecorder.latest.pause).not.toHaveBeenCalled();
  });

  it("counts only the time actually recorded against the limit", async () => {
    await renderCamera();
    await pressShutter(400);

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
    await pressShutter(400);
    await pressShutter(50); // pause

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /finish video/i }));
    });

    expect(FakeMediaRecorder.latest.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /use video/i })).toBeInTheDocument();
  });

  it("stops itself once the take reaches the limit", async () => {
    await renderCamera();
    await pressShutter(400);

    await act(async () => void vi.advanceTimersByTime(15_000));

    expect(FakeMediaRecorder.latest.stop).toHaveBeenCalledTimes(1);
  });

  it("ends the take on a tap where the recorder cannot pause", async () => {
    // Safari before 14.1 exposes no pause().
    await renderCamera();
    await pressShutter(400);

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

    await pressShutter(400);
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
    await pressShutter(400);

    const recorded = FakeMediaRecorder.latest.stream;
    expect(recorded.getVideoTracks().map((t) => t.label)).toEqual(["canvas"]);
    expect(recorded.getAudioTracks().map((t) => t.label)).toEqual(["mic"]);
  });

  it("leaves the take running across a flip", async () => {
    await renderCamera();
    await pressShutter(400);
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
    await pressShutter(400);

    await flip();

    expect(camera.audio.stop).not.toHaveBeenCalled();
  });

  it("keeps the clock running across a flip", async () => {
    await renderCamera();
    await pressShutter(400);
    await act(async () => void vi.advanceTimersByTime(2000));

    await flip();
    await act(async () => void vi.advanceTimersByTime(2000));

    expect(screen.getByText("00:04")).toBeInTheDocument();
  });

  it("offers the flip during a take but not in review", async () => {
    await renderCamera();
    await pressShutter(400);
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
    await pressShutter(400);
    const recorder = FakeMediaRecorder.latest;
    expect(recorder.stream.getVideoTracks().map((t) => t.label)).toEqual(["camera-1"]);

    camera.getUserMedia.mockClear();
    await flip();

    // No swap was attempted, and the take carries on untouched.
    expect(camera.getUserMedia).not.toHaveBeenCalled();
    expect(recorder.state).toBe("recording");
    expect(screen.getByText(/Tap to pause/)).toBeInTheDocument();
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
    await pressShutter(400);
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

    await pressShutter(400);

    const take = created.at(-1)!;
    expect(take.width / take.height).toBeCloseTo(16 / 9, 2);
    expect(take.height).toBe(1080);
  });
});

