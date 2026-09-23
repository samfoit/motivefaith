import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCamera } from "../useCamera";

// ---------------------------------------------------------------------------
// Fake camera
// ---------------------------------------------------------------------------

interface FakeTrack {
  kind: "video" | "audio";
  stop: ReturnType<typeof vi.fn>;
  applyConstraints: ReturnType<typeof vi.fn>;
  getCapabilities?: ReturnType<typeof vi.fn>;
}

function fakeTrack(zoom?: { min: number; max: number; step: number }): FakeTrack {
  return {
    kind: "video",
    stop: vi.fn(),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
    // A browser that cannot report capabilities omits the method entirely.
    ...(zoom === undefined ? {} : { getCapabilities: vi.fn(() => ({ zoom })) }),
  };
}

function fakeAudioTrack(): FakeTrack {
  return { kind: "audio", stop: vi.fn(), applyConstraints: vi.fn() };
}

/** jsdom has no MediaStream, and the hook builds one to splice tracks. */
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

function fakeStream(tracks: FakeTrack[]): MediaStream {
  const s = new FakeMediaStream();
  tracks.forEach((t) => s.addTrack(t));
  return s as unknown as MediaStream;
}

/** Install a getUserMedia that hands back `takes` in order, one per call. */
function installCamera(takes: FakeTrack[][]) {
  let call = 0;
  const getUserMedia = vi.fn(async () =>
    fakeStream(takes[Math.min(call++, takes.length - 1)]),
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return getUserMedia;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("MediaStream", FakeMediaStream);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCamera zoom", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("drives the camera itself when the track reports a zoom range", async () => {
    const track = fakeTrack({ min: 1, max: 8, step: 0.1 });
    installCamera([[track]]);

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.requestCamera("environment");
    });

    expect(result.current.isOpticalZoom).toBe(true);
    expect(result.current.zoomRange).toEqual({ min: 1, max: 8, step: 0.1 });

    act(() => result.current.setZoom(3));

    expect(result.current.zoom).toBe(3);
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 3 }] });
  });

  it("falls back to a digital range the caller has to crop for", async () => {
    const track = fakeTrack(); // no getCapabilities at all
    installCamera([[track]]);

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.requestCamera("environment");
    });

    expect(result.current.isOpticalZoom).toBe(false);
    expect(result.current.zoomRange).toEqual({ min: 1, max: 4, step: 0.1 });

    act(() => result.current.setZoom(2.5));

    expect(result.current.zoom).toBe(2.5);
    // Nothing is asked of a camera that cannot zoom.
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it("ignores a zoom range the camera reports as a single point", async () => {
    installCamera([[fakeTrack({ min: 1, max: 1, step: 0.1 })]]);

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.requestCamera("environment");
    });

    expect(result.current.isOpticalZoom).toBe(false);
    expect(result.current.zoomRange.max).toBe(4);
  });

  it("clamps to the ends of the range rather than overshooting", async () => {
    installCamera([[fakeTrack({ min: 1, max: 5, step: 0.1 })]]);

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.requestCamera("environment");
    });

    act(() => result.current.setZoom(99));
    expect(result.current.zoom).toBe(5);

    act(() => result.current.setZoom(-4));
    expect(result.current.zoom).toBe(1);
  });

  it("starts the next camera wide, with its own range", async () => {
    const back = fakeTrack({ min: 1, max: 8, step: 0.1 });
    const front = fakeTrack(); // front camera reports nothing
    installCamera([[back], [front]]);

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.requestCamera("environment");
    });
    act(() => result.current.setZoom(4));
    expect(result.current.zoom).toBe(4);

    await act(async () => {
      await result.current.switchCamera();
    });

    expect(result.current.facingMode).toBe("user");
    expect(result.current.zoom).toBe(1);
    expect(result.current.isOpticalZoom).toBe(false);
    expect(back.stop).toHaveBeenCalled();
  });

  it("keeps the viewfinder usable when the camera refuses a zoom factor", async () => {
    const track = fakeTrack({ min: 1, max: 8, step: 0.1 });
    track.applyConstraints.mockRejectedValue(new Error("OverconstrainedError"));
    installCamera([[track]]);

    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await result.current.requestCamera("environment");
    });

    await act(async () => {
      result.current.setZoom(6);
    });

    expect(result.current.zoom).toBe(6);
  });
});

/**
 * Flipping mid-recording cannot tear the stream down: the audio track is
 * already being captured, and the take would go silent. Only the video source
 * is exchanged, and everything about that exchange is load-bearing.
 */
describe("useCamera mid-recording flip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  async function openCamera(takes: FakeTrack[][]) {
    const getUserMedia = installCamera(takes);
    const view = renderHook(() => useCamera({ audio: true }));
    await act(async () => {
      await view.result.current.requestCamera("environment");
    });
    return { ...view, getUserMedia };
  }

  it("keeps the audio track and exchanges only the video one", async () => {
    const video = fakeTrack();
    const audio = fakeAudioTrack();
    const nextVideo = fakeTrack();
    const { result } = await openCamera([[video, audio], [nextVideo]]);

    await act(async () => {
      await result.current.switchCamera({ keepAudio: true });
    });

    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
    expect(result.current.facingMode).toBe("user");
    expect(result.current.stream?.getVideoTracks()).toEqual([nextVideo]);
    expect(result.current.stream?.getAudioTracks()).toEqual([audio]);
  });

  it("hands back a new stream object, so the viewfinder re-reads it", async () => {
    const { result } = await openCamera([[fakeTrack(), fakeAudioTrack()], [fakeTrack()]]);
    const before = result.current.stream;

    await act(async () => {
      await result.current.switchCamera({ keepAudio: true });
    });

    expect(result.current.stream).not.toBe(before);
  });

  it("does not ask for the microphone a second time", async () => {
    const { result, getUserMedia } = await openCamera([
      [fakeTrack(), fakeAudioTrack()],
      [fakeTrack()],
    ]);

    await act(async () => {
      await result.current.switchCamera({ keepAudio: true });
    });

    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { facingMode: { ideal: "user" } },
    });
  });

  it("re-reads the zoom range, because it is a different camera", async () => {
    const back = fakeTrack({ min: 1, max: 8, step: 0.1 });
    const front = fakeTrack(); // reports nothing
    const { result } = await openCamera([[back, fakeAudioTrack()], [front]]);

    act(() => result.current.setZoom(5));
    await act(async () => {
      await result.current.switchCamera({ keepAudio: true });
    });

    expect(result.current.zoom).toBe(1);
    expect(result.current.isOpticalZoom).toBe(false);
  });

  it("stays put when the other camera will not open, rather than erroring out", async () => {
    const video = fakeTrack();
    const audio = fakeAudioTrack();
    const getUserMedia = installCamera([[video, audio]]);
    const { result } = renderHook(() => useCamera({ audio: true }));
    await act(async () => {
      await result.current.requestCamera("environment");
    });

    getUserMedia.mockRejectedValueOnce(new DOMException("nope", "NotReadableError"));
    await act(async () => {
      await result.current.switchCamera({ keepAudio: true });
    });

    // A take in progress must not be replaced by an error screen.
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.state).toBe("granted");
    expect(result.current.facingMode).toBe("environment");
    expect(video.stop).not.toHaveBeenCalled();
  });

  it("ignores a second flip while the first is still in flight", async () => {
    const { result, getUserMedia } = await openCamera([
      [fakeTrack(), fakeAudioTrack()],
      [fakeTrack()],
      [fakeTrack()],
    ]);
    getUserMedia.mockClear();

    await act(async () => {
      await Promise.all([
        result.current.switchCamera({ keepAudio: true }),
        result.current.switchCamera({ keepAudio: true }),
      ]);
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.facingMode).toBe("user");
  });
});
