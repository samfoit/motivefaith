import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VideoTrimBar, clampTrimStart } from "../VideoTrimBar";

/** A 40 s video, 15 s of it sent, on a track 400 px wide: 10 px a second. */
function renderBar(start = 0, { duration = 40, length = 15 } = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <VideoTrimBar
      duration={duration}
      length={length}
      start={start}
      onChange={onChange}
      onCommit={onCommit}
    />,
  );
  const slider = screen.getByRole("slider", { name: "Part of the video to send" });
  const track = slider.parentElement!;
  // jsdom lays nothing out.
  track.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 44, right: 400, bottom: 44 }) as DOMRect;
  return { slider, track, onChange, onCommit };
}

describe("VideoTrimBar", () => {
  it("says which part it will send", () => {
    const { slider } = renderBar(12);

    expect(slider).toHaveAttribute("aria-valuetext", "0:12 to 0:27");
    expect(slider).toHaveAttribute("aria-valuemax", "25");
    expect(screen.getByText("0:12 – 0:27 of 0:40")).toBeInTheDocument();
  });

  it("moves a second at a time on the arrows, five on the page keys, and to either end", () => {
    const { slider, onChange, onCommit } = renderBar(12);

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenLastCalledWith(13);
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(onCommit).toHaveBeenLastCalledWith(7);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith(25);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith(0);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("keeps the window inside the video", () => {
    const { slider, onCommit } = renderBar(24);

    fireEvent.keyDown(slider, { key: "PageUp" });

    expect(onCommit).toHaveBeenLastCalledWith(25);
  });

  it("drags the window from where it was taken hold of", () => {
    // The window covers 100–250 px.
    const { track, onChange, onCommit } = renderBar(10);

    fireEvent.pointerDown(track, { pointerId: 1, clientX: 150 });
    expect(onChange).toHaveBeenLastCalledWith(10);
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 200 });
    expect(onChange).toHaveBeenLastCalledWith(15);
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 230 });

    expect(onCommit).toHaveBeenCalledWith(18);
  });

  it("centres the window on a press anywhere else on the track", () => {
    // The window covers 0–150 px; 300 px is 30 s, so it centres there.
    const { track, onChange, onCommit } = renderBar(0);

    fireEvent.pointerDown(track, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 300 });

    expect(onChange).toHaveBeenLastCalledWith(22.5);
    expect(onCommit).toHaveBeenCalledWith(22.5);
  });

  it("ignores a pointer moving over it with nothing held", () => {
    const { track, onChange, onCommit } = renderBar(0);

    fireEvent.pointerMove(track, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 300 });

    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("clampTrimStart", () => {
  it("keeps a window inside the video it is on", () => {
    expect(clampTrimStart(-3, 40, 15)).toBe(0);
    expect(clampTrimStart(12, 40, 15)).toBe(12);
    expect(clampTrimStart(30, 40, 15)).toBe(25);
    // A video shorter than the window starts at the start.
    expect(clampTrimStart(5, 10, 15)).toBe(0);
  });
});
