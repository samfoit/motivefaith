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
  onstatechange: (() => void) | null;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  destination: object;
  analyser: { fftSize: number; smoothingTimeConstant: number; connect: ReturnType<typeof vi.fn> };
  gain: { gain: { value: number }; connect: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    },
  });
  vi.stubGlobal(
    "AudioContext",
    vi.fn(function (this: unknown) {
      const destination = {};
      const gain = { gain: { value: 1 }, connect: vi.fn((n) => n) };
      const analyser = { fftSize: 2048, smoothingTimeConstant: 0.8, connect: vi.fn(() => gain) };
      ctx = {
        state: "suspended",
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
