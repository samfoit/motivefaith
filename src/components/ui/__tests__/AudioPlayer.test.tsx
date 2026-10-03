import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudioPlayer } from "../AudioPlayer";

/** jsdom's media element has no duration, playback or seeking of its own. */
function fakeMedia(el: HTMLAudioElement, duration: number) {
  let current = 0;
  let paused = true;
  Object.defineProperty(el, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(el, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(el, "currentTime", {
    configurable: true,
    get: () => current,
    set: (t: number) => {
      current = t;
    },
  });
  el.play = vi.fn(async () => {
    paused = false;
    fireEvent.play(el);
  });
  el.pause = vi.fn(() => {
    paused = true;
    fireEvent.pause(el);
  });
  return {
    setDuration: (d: number) => {
      duration = d;
    },
    get current() {
      return current;
    },
  };
}

function setup(duration: number) {
  const { container } = render(<AudioPlayer src="blob:voice" />);
  const audio = container.querySelector("audio")!;
  return { audio, media: fakeMedia(audio, duration) };
}

describe("AudioPlayer", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the length before playing, and plays and pauses from one button", async () => {
    const { audio } = setup(12);
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText("0:12")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play voice note" }));
    expect(audio.play).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Pause voice note" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause voice note" }));
    expect(audio.pause).toHaveBeenCalled();
  });

  it("works out the length of a recorder file that reports Infinity", () => {
    const { audio, media } = setup(Infinity);
    fireEvent.loadedMetadata(audio);
    // Not shown as Infinity; the player seeks past the end to find out.
    expect(screen.getByText("–:––")).toBeInTheDocument();
    expect(media.current).toBeGreaterThan(1e100);

    media.setDuration(7.4);
    fireEvent.timeUpdate(audio);

    expect(screen.getByText("0:07")).toBeInTheDocument();
    expect(media.current).toBe(0);
  });

  it("seeks from the track", () => {
    const { audio, media } = setup(20);
    fireEvent.loadedMetadata(audio);

    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "5" } });

    expect(media.current).toBe(5);
    expect(screen.getByText("0:05")).toBeInTheDocument();
  });
});
