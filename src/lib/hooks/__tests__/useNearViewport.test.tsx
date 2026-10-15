import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { useNearViewport } from "../useNearViewport";

let callback: IntersectionObserverCallback | null = null;
const disconnect = vi.fn();

class FakeObserver {
  constructor(cb: IntersectionObserverCallback) {
    callback = cb;
  }
  observe() {}
  disconnect = disconnect;
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  return <div ref={ref}>{near ? "near" : "far"}</div>;
}

function report(isIntersecting: boolean) {
  act(() => {
    callback?.(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

describe("useNearViewport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    callback = null;
  });

  it("follows the element in and out of range", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { unmount } = render(<Probe />);
    expect(screen.getByText("far")).toBeInTheDocument();

    report(true);
    expect(screen.getByText("near")).toBeInTheDocument();
    report(false);
    expect(screen.getByText("far")).toBeInTheDocument();

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("counts as near where IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    expect(screen.getByText("near")).toBeInTheDocument();
  });
});
