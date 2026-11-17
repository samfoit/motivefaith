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

  // The waveform is the take's own, so the sound goes straight from the
  // element to the speakers: on an iPhone a note routed through Web Audio is
  // silent to it, and can be silent to the listener too.
  it("plays without touching Web Audio", () => {
    const AudioContext = vi.fn();
    vi.stubGlobal("AudioContext", AudioContext);
    const { audio } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(audio.play).toHaveBeenCalled();
    expect(AudioContext).not.toHaveBeenCalled();
  });

  it("says in the readout that the waveform is the one recorded", async () => {
    render(
      <VoicePlayback src="blob:take" wave={[0.2, 0.6, 0.3]} debug={{ take: "audio/mp4, 12 kB" }} />,
    );

    const readout = await screen.findByText("audio/mp4, 12 kB", undefined, { timeout: 1000 });
    expect(readout.closest("dl")).toHaveTextContent("3 bars, as recorded");
  });

  // An iPhone whose meter heard nothing hands over a flat wave: the review
  // works the bars out from the recording instead of drawing a flat line.
  it("works the waveform out from the recording when the meter heard nothing", async () => {
    const samples = new Float32Array(44100).fill(0.25);
    vi.stubGlobal(
      "OfflineAudioContext",
      vi.fn(function () {
        return {
          decodeAudioData: vi.fn(async () => ({
            sampleRate: 44100,
            getChannelData: () => samples,
          })),
        };
      }),
    );
    const take = new Blob(["m4a"], { type: "audio/mp4" });
    take.arrayBuffer = async () => new ArrayBuffer(8);

    render(<VoicePlayback src="blob:take" wave={[0, 0, 0]} take={take} debug={{}} />);

    // One second of sound at 80 ms a bar.
    expect(await screen.findByText("13 bars, from the file", undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it("has no waveform to show when the recording can't be decoded either", async () => {
    vi.stubGlobal("OfflineAudioContext", undefined);
    render(<VoicePlayback src="blob:take" take={new Blob(["x"])} debug={{ take: "audio/webm" }} />);

    const readout = await screen.findByText("audio/webm", undefined, { timeout: 1000 });
    expect(readout.closest("dl")).toHaveTextContent("wavenone");
  });

  it("shows no readout otherwise", () => {
    setup();
    expect(screen.queryByTestId("voice-debug")).not.toBeInTheDocument();
  });
});
