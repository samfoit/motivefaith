import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MobileFactBanner } from "../habit-facts";

/**
 * The first fact has to be deterministic.
 *
 * It used to be chosen with `Math.random()` in a `useState` initializer, which
 * also ran during SSR — so the server and the client picked different facts.
 * React never warned, because the card is keyed by the fact text and silently
 * remounted, but the user saw the server's fact swap for a different one about
 * 1.7s after first paint, on every load.
 */
describe("useCyclingFact (via MobileFactBanner)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  function currentFact() {
    // The banner renders the emoji and the fact text as siblings.
    return screen.getByText(/./, { selector: "p.text-xs" }).textContent;
  }

  it("renders the same fact on every mount, so SSR and hydration agree", () => {
    render(<MobileFactBanner />);
    const first = currentFact();
    cleanup();

    render(<MobileFactBanner />);
    const second = currentFact();
    cleanup();

    render(<MobileFactBanner />);
    expect(first).toBe(second);
    expect(currentFact()).toBe(first);
    expect(first).toBeTruthy();
  });

  it("does not change the fact until a full interval has elapsed", () => {
    render(<MobileFactBanner />);
    const initial = currentFact();

    // Anything short of the interval — the window in which a hydration swap
    // would have been visible — must leave the fact alone.
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(currentFact()).toBe(initial);
  });

  it("applies the random offset on the first tick, not before", () => {
    // Pin the offset so the assertion is exact rather than "something changed".
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    render(<MobileFactBanner />);
    const initial = currentFact();
    expect(randomSpy).not.toHaveBeenCalled(); // nothing random during render

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(randomSpy).toHaveBeenCalled();
    const afterOffset = currentFact();
    expect(afterOffset).not.toBe(initial);

    randomSpy.mockRestore();
  });
});
