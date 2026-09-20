import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useDelayedLoading,
  SKELETON_DELAY_MS,
  SKELETON_MIN_MS,
} from "../useDelayedLoading";

/**
 * This timing is load-bearing: the measured problem was skeletons appearing
 * for 79-86ms and reading as a glitch (DIAGNOSIS.md R4). Both halves of the
 * rule need to hold, so both are pinned here.
 */
describe("useDelayedLoading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows nothing at all when loading resolves inside the delay window", () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useDelayedLoading(loading),
      { initialProps: { loading: true } },
    );

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 50);
    });
    expect(result.current).toBe(false);

    rerender({ loading: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });

  it("shows the skeleton once the delay elapses", () => {
    const { result } = renderHook(() => useDelayedLoading(true));

    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(result.current).toBe(true);
  });

  it("holds the skeleton for the minimum once it has been shown", () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useDelayedLoading(loading),
      { initialProps: { loading: true } },
    );

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(result.current).toBe(true);

    // Data arrives almost immediately after the skeleton appeared.
    rerender({ loading: false });
    act(() => {
      vi.advanceTimersByTime(SKELETON_MIN_MS - 100);
    });
    expect(result.current).toBe(true); // still held — would otherwise blink

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(false);
  });

  it("hides immediately when the minimum has already elapsed", () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useDelayedLoading(loading),
      { initialProps: { loading: true } },
    );

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS + SKELETON_MIN_MS + 500);
    });
    expect(result.current).toBe(true);

    rerender({ loading: false });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(false);
  });

  it("does not show a skeleton for work that was never loading", () => {
    const { result } = renderHook(() => useDelayedLoading(false));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });
});
