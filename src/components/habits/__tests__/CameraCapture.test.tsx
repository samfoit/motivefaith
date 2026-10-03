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
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeInTheDocument();
  });

  it("pauses on the next tap and picks up again on the one after", async () => {
    await renderCamera();
    await pressShutter(400);

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
    expect(screen.queryByRole("radio", { name: "Camera" })).not.toBeInTheDocument();

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
    expect(screen.getByRole("radio", { name: "Camera" })).toHaveAttribute("aria-checked", "true");
  });
});
