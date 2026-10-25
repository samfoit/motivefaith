import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  canTranscodeVideo,
  fitWithin,
  transcodeVideo,
  TranscodeError,
} from "../transcode-video";

/**
 * The real pipeline is checked in a browser; jsdom plays no media. These pin
 * its order of events and its cleanup — what runs inside the tap, where the
 * take starts and stops, what each way of failing comes back as — with the
 * video, Web Audio, canvas and recorder standing in.
 */

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeTrack {
  kind: "audio" | "video";
  stop = vi.fn();
  constructor(kind: "audio" | "video") {
    this.kind = kind;
  }
}

class FakeMediaStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
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

class FakeRecorder {
  static latest: FakeRecorder;
  static isTypeSupported = (type: string) => type.startsWith("video/mp4");

  stream: FakeMediaStream;
  options: MediaRecorderOptions;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  start = vi.fn(() => {
    this.state = "recording";
  });
  pause = vi.fn(() => {
    this.state = "paused";
  });
  resume = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["mp4"], { type: "video/mp4" }) });
    this.onstop?.();
  });

  constructor(stream: FakeMediaStream, options: MediaRecorderOptions) {
    this.stream = stream;
    this.options = options;
    FakeRecorder.latest = this;
  }
}

/** Methods on the prototype, where canTranscodeVideo looks for them. */
class FakeAudioContext {
  static latest: FakeAudioContext;

  state = "running";
  closed = false;
  soundConnected = false;
  sink = new FakeMediaStream([new FakeTrack("audio")]);

  constructor() {
    FakeAudioContext.latest = this;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  createMediaElementSource() {
    return {
      connect: () => {
        this.soundConnected = true;
      },
      disconnect: () => {
        this.soundConnected = false;
      },
    };
  }
  createMediaStreamDestination() {
    return { stream: this.sink };
  }
}

/**
 * The video transcodeVideo makes, played by hand: its metadata arrives when
 * the test says, a seek answers with "seeked", and playback is wherever the
 * test puts it.
 */
function installVideo({ width = 1920, height = 1080, duration = 40 } = {}) {
  const make = document.createElement.bind(document);
  const media = {
    video: null as unknown as HTMLVideoElement,
    ready: 0,
    time: 0,
    paused: true,
  };
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, options?: ElementCreationOptions) => {
      const el = make(tag, options);
      if (tag !== "video") return el;
      Object.defineProperties(el, {
        readyState: { get: () => media.ready },
        videoWidth: { get: () => (media.ready ? width : 0) },
        videoHeight: { get: () => (media.ready ? height : 0) },
        duration: { get: () => (media.ready ? duration : NaN) },
        paused: { get: () => media.paused },
        currentTime: {
          get: () => media.time,
          set: (t: number) => {
            media.time = t;
            queueMicrotask(() => el.dispatchEvent(new Event("seeked")));
          },
        },
      });
      const video = el as HTMLVideoElement;
      video.play = vi.fn(() => {
        media.paused = false;
        return Promise.resolve();
      });
      video.pause = vi.fn(() => {
        media.paused = true;
      });
      video.load = vi.fn();
      media.video = video;
      return el;
    },
  );

  return {
    get video() {
      return media.video;
    },
    loadMetadata() {
      media.ready = 1;
      media.video.dispatchEvent(new Event("loadedmetadata"));
    },
    /** Playback has got to `t`. */
    playTo(t: number) {
      media.time = t;
    },
  };
}

let frames: FrameRequestCallback[] = [];

/** Draw the next frame. */
function frame() {
  const due = frames;
  frames = [];
  due.forEach((cb) => cb(performance.now()));
}

/** Every promise and queued event so far. */
const settle = () => new Promise((r) => setTimeout(r, 0));

let hidden = false;

beforeEach(() => {
  frames = [];
  hidden = false;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  URL.createObjectURL = vi.fn(() => "blob:source");
  URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement["getContext"];
  (
    HTMLCanvasElement.prototype as unknown as { captureStream: () => FakeMediaStream }
  ).captureStream = () => new FakeMediaStream([new FakeTrack("video")]);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "hidden");
  Reflect.deleteProperty(HTMLCanvasElement.prototype, "captureStream");
});

const movie = () => new File(["mov"], "IMG_0001.MOV", { type: "video/quicktime" });

/** Started, its metadata in, and recording from `start`. */
async function startedAt(start: number, length = 15, opts: { duration?: number } = {}) {
  const media = installVideo({ duration: opts.duration ?? 40 });
  const progress: number[] = [];
  const controller = new AbortController();
  const done = transcodeVideo(movie(), {
    start,
    length,
    signal: controller.signal,
    onProgress: (f) => progress.push(f),
  });
  media.loadMetadata();
  await settle();
  return { media, progress, controller, done };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fitWithin", () => {
  it("brings a phone's video down to 720p, keeping its shape", () => {
    expect(fitWithin(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 720, height: 1280 });
  });

  it("never enlarges a small video, and keeps both sides even", () => {
    expect(fitWithin(640, 360)).toEqual({ width: 640, height: 360 });
    expect(fitWithin(1279, 719)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin(1440, 1080)).toEqual({ width: 1280, height: 960 });
  });
});

describe("canTranscodeVideo", () => {
  it("needs Web Audio, a canvas stream and a recorder", () => {
    expect(canTranscodeVideo()).toBe(true);
    vi.stubGlobal("AudioContext", undefined);
    expect(canTranscodeVideo()).toBe(false);
  });
});

describe("transcodeVideo", () => {
  it("plays the video before it awaits anything, so it runs inside the tap", () => {
    const media = installVideo();
    void transcodeVideo(movie(), { start: 0, length: 15 }).catch(() => {});

    expect(media.video.play).toHaveBeenCalledTimes(1);
    expect(media.video.pause).toHaveBeenCalledTimes(1);
    expect(media.video.isConnected).toBe(true);
    expect(FakeAudioContext.latest).toBeDefined();
  });

  it("records the chosen part, smaller, and hands back an MP4", async () => {
    const { media, progress, done } = await startedAt(12);

    expect(media.video.currentTime).toBe(12);
    const recorder = FakeRecorder.latest;
    expect(recorder.start).toHaveBeenCalled();
    expect(recorder.options).toMatchObject({
      mimeType: "video/mp4;codecs=avc1,mp4a.40.2",
      videoBitsPerSecond: 2_500_000,
    });
    // The canvas's picture and the video's sound, through Web Audio.
    expect(recorder.stream.getVideoTracks()).toHaveLength(1);
    expect(recorder.stream.getAudioTracks()).toEqual(FakeAudioContext.latest.sink.tracks);
    expect(FakeAudioContext.latest.soundConnected).toBe(true);

    media.playTo(19.5);
    frame();
    expect(progress.at(-1)).toBe(0.5);
    expect(recorder.stop).not.toHaveBeenCalled();

    media.playTo(27);
    frame();
    const file = await done;

    expect(recorder.stop).toHaveBeenCalled();
    expect(file.type).toBe("video/mp4");
    expect(file.name).toMatch(/^video-\d+\.mp4$/);
    expect(progress.at(-1)).toBe(1);
  });

  it("lets go of everything it took once it is done", async () => {
    const { media, done } = await startedAt(0);
    const stream = FakeRecorder.latest.stream;

    media.playTo(15);
    frame();
    await done;

    expect(media.video.isConnected).toBe(false);
    expect(media.video.load).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
    expect(FakeAudioContext.latest.closed).toBe(true);
    expect(FakeAudioContext.latest.soundConnected).toBe(false);
    stream.getTracks().forEach((t) => expect(t.stop).toHaveBeenCalled());
  });

  it("ends with the video when the video ends first", async () => {
    const { media, done } = await startedAt(0, 15, { duration: 6 });

    media.playTo(6);
    media.video.dispatchEvent(new Event("ended"));

    await expect(done).resolves.toBeInstanceOf(File);
  });

  it("stops on a cancel, without a file", async () => {
    const { media, controller, done } = await startedAt(0);

    media.playTo(4);
    frame();
    controller.abort();

    await expect(done).rejects.toMatchObject({ reason: "cancelled" });
    expect(FakeRecorder.latest.stop).toHaveBeenCalled();
    expect(media.video.isConnected).toBe(false);
    expect(FakeAudioContext.latest.closed).toBe(true);
  });

  it("pauses with the app in the background, and picks up where it was", async () => {
    const { media, done } = await startedAt(0);
    const recorder = FakeRecorder.latest;
    media.playTo(5);
    frame();

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(recorder.pause).toHaveBeenCalled();
    expect(media.video.paused).toBe(true);

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(recorder.resume).toHaveBeenCalled();
    expect(media.video.paused).toBe(false);

    media.playTo(15);
    frame();
    await expect(done).resolves.toBeInstanceOf(File);
  });

  it("fails as undecodable for a video the browser can't open", async () => {
    const media = installVideo();
    const done = transcodeVideo(movie(), { start: 0, length: 15 });

    media.video.dispatchEvent(new Event("error"));

    await expect(done).rejects.toMatchObject({ reason: "decode" });
    expect(media.video.isConnected).toBe(false);
  });

  it("gives up on playback that stops moving", async () => {
    const { media, done } = await startedAt(0);
    const now = performance.now();
    media.playTo(3);
    frame();

    vi.spyOn(performance, "now").mockReturnValue(now + 6000);
    frame();

    await expect(done).rejects.toMatchObject({ reason: "decode" });
  });

  it("refuses up front where the browser can't do it", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const create = vi.spyOn(document, "createElement");

    const err = await transcodeVideo(movie(), { start: 0, length: 15 }).catch((e) => e);

    expect(err).toBeInstanceOf(TranscodeError);
    expect(err.reason).toBe("unsupported");
    expect(create).not.toHaveBeenCalledWith("video");
  });
});
