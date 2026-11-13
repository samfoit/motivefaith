import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useVoiceRecording } from "@/lib/hooks/useVoiceRecording";

/**
 * The level meter on iPhone: the context is made after the mic prompt, so
 * iOS hands it over suspended, and WebKit runs only nodes that reach the
 * destination. Either one leaves the meter reading silence.
 */

class FakeRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

let ctx: {
  state: string;
  sampleRate: number;
  onstatechange: (() => void) | null;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  destination: object;
  analyser: {
    fftSize: number;
    smoothingTimeConstant: number;
    connect: ReturnType<typeof vi.fn>;
    getFloatTimeDomainData: ReturnType<typeof vi.fn>;
  };
  gain: { gain: { value: number }; connect: ReturnType<typeof vi.fn> };
};

/** The sample value the fake mic hands the analyser: 0 is a dead source. */
let heard = 0;

beforeEach(() => {
  heard = 0;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
        getAudioTracks: () => [{ readyState: "live", muted: false, enabled: true }],
      }),
    },
  });
  vi.stubGlobal(
    "AudioContext",
    vi.fn(function (this: unknown) {
      const destination = {};
      const gain = { gain: { value: 1 }, connect: vi.fn((n) => n) };
      const analyser = {
        fftSize: 2048,
        smoothingTimeConstant: 0.8,
        connect: vi.fn(() => gain),
        getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(heard)),
      };
      ctx = {
        state: "suspended",
        sampleRate: 48000,
        onstatechange: null,
        resume: vi.fn(() => Promise.resolve()),
        close: vi.fn(() => Promise.resolve()),
        destination,
        analyser,
        gain,
      };
      return {
        get state() {
          return ctx.state;
        },
        set onstatechange(fn: (() => void) | null) {
          ctx.onstatechange = fn;
        },
        get onstatechange() {
          return ctx.onstatechange;
        },
        resume: ctx.resume,
        close: ctx.close,
        sampleRate: ctx.sampleRate,
        destination,
        createAnalyser: () => analyser,
        createGain: () => gain,
        createMediaStreamSource: () => ({ connect: vi.fn() }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useVoiceRecording meter", () => {
  it("resumes a context iOS starts suspended", async () => {
    const { result } = renderHook(() => useVoiceRecording({ maxDuration: 60, onFinish: vi.fn() }));
    await act(() => result.current.start());
    expect(ctx.resume).toHaveBeenCalled();
    expect(result.current.analyserRef.current).toBe(ctx.analyser);
  });

  it("wakes the context again when a call interrupts the take", async () => {
    const { result } = renderHook(() => useVoiceRecording({ maxDuration: 60, onFinish: vi.fn() }));
    await act(() => result.current.start());
    ctx.resume.mockClear();
    ctx.state = "interrupted";
    ctx.onstatechange?.();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("pulls the analyser through a muted gain to the speakers", async () => {
    const { result } = renderHook(() => useVoiceRecording({ maxDuration: 60, onFinish: vi.fn() }));
    await act(() => result.current.start());
    expect(ctx.analyser.connect).toHaveBeenCalledWith(ctx.gain);
    expect(ctx.gain.gain.value).toBe(0);
    expect(ctx.gain.connect).toHaveBeenCalledWith(ctx.destination);
  });
});

/**
 * The readout a phone shows in place of a console (VoiceDebug): enough to
 * tell a context that never woke from a mic that hands over nothing.
 */
describe("useVoiceRecording readout", () => {
  it("reports a context that stays suspended and a source reading nothing", async () => {
    const { result } = renderHook(() => useVoiceRecording({ maxDuration: 60, onFinish: vi.fn() }));
    await act(() => result.current.start());
    ctx.resume.mockImplementation(() => Promise.reject(new DOMException("no", "NotAllowedError")));
    await act(async () => ctx.onstatechange?.());

    expect(result.current.inspect()).toMatchObject({
      recorder: "recording",
      mic: "live",
      context: "suspended, 48000 Hz",
      states: "suspended",
      resume: "refused (NotAllowedError)",
      level: "all zeros",
    });
  });

  it("reports a running context and how loud the mic is", async () => {
    const { result } = renderHook(() => useVoiceRecording({ maxDuration: 60, onFinish: vi.fn() }));
    await act(() => result.current.start());
    ctx.state = "running";
    await act(async () => ctx.onstatechange?.());
    heard = 0.1;

    expect(result.current.inspect()).toMatchObject({
      context: "running, 48000 Hz",
      states: "suspended > running",
      resume: "resolved",
      level: "-20 dB, loudest -20 dB",
    });

    // Speech is full of gaps: a quiet moment keeps what came before it.
    heard = 0;
    expect(result.current.inspect().level).toBe("zeros, loudest -20 dB");
  });

  it("says why there is no meter when Web Audio can't be set up", async () => {
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        throw new Error("nope");
      }),
    );
    const { result } = renderHook(() => useVoiceRecording({ maxDuration: 60, onFinish: vi.fn() }));
    await act(() => result.current.start());

    expect(result.current.inspect()).toMatchObject({
      context: "Error: nope",
      level: "no analyser",
    });
  });
});
