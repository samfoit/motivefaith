import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoicePlayback } from "../VoicePlayback";

function fakeMedia(el: HTMLAudioElement, duration: number) {
  let paused = true;
  Object.defineProperty(el, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(el, "paused", { configurable: true, get: () => paused });
  el.play = vi.fn(async () => {
    paused = false;
    fireEvent.play(el);
  });
  el.pause = vi.fn(() => {
    paused = true;
    fireEvent.pause(el);
  });
}

function fakeAudioContext() {
  const analyser = { fftSize: 0, connect: vi.fn(), getByteFrequencyData: vi.fn() };
  const source = { connect: vi.fn() };
  const ctx = {
    destination: {},
    createAnalyser: vi.fn(() => analyser),
    createMediaElementSource: vi.fn(() => source),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  vi.stubGlobal(
    "AudioContext",
    vi.fn(function () {
      return ctx;
    }),
  );
  return { ctx, analyser, source };
}

function setup(duration = 9) {
  const view = render(<VoicePlayback src="blob:take" />);
  const audio = view.container.querySelector("audio")!;
  fakeMedia(audio, duration);
  fireEvent.loadedMetadata(audio);
  return { ...view, audio };
}

describe("VoicePlayback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the take's length and plays from the big button", async () => {
    const { audio } = setup(9);
    expect(screen.getByText("0:09")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(audio.play).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Pause recording" })).toBeInTheDocument();
  });

  it("routes the playback through an analyser for the meter, once", async () => {
    const { ctx, analyser, source } = fakeAudioContext();
    const { audio, unmount } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(audio);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.connect).toHaveBeenCalledWith(ctx.destination);
    expect(ctx.resume).toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "Pause recording" }));
    fireEvent.click(await screen.findByRole("button", { name: "Play recording" }));
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);

    unmount();
    expect(ctx.close).toHaveBeenCalled();
  });

  it("still plays without Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    const { audio } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(audio.play).toHaveBeenCalled();
  });
});
