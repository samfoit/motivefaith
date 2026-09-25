import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useCameraGestures,
  type CameraGestureHandlers,
  type UseCameraGesturesOptions,
} from "../useCameraGestures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The slice of a PointerEvent the recogniser actually reads. */
function pointer(id: number, x: number, y: number, t: number) {
  return { pointerId: id, clientX: x, clientY: y, timeStamp: t } as React.PointerEvent;
}

/** Press, optionally drag, then release a single pointer. */
function tap(
  handlers: CameraGestureHandlers,
  { x = 100, y = 300, t = 0, dx = 0, dy = 0, duration = 60, id = 1 } = {},
) {
  act(() => {
    handlers.onPointerDown(pointer(id, x, y, t));
    if (dx || dy) handlers.onPointerMove(pointer(id, x + dx, y + dy, t + duration / 2));
    handlers.onPointerUp(pointer(id, x + dx, y + dy, t + duration));
  });
}

function setup(options: Partial<UseCameraGesturesOptions> = {}) {
  const spies = {
    onDoubleTap: vi.fn(),
    onPinchStart: vi.fn(),
    onPinch: vi.fn(),
    onPinchEnd: vi.fn(),
    onSwipeDown: vi.fn(),
  };
  const view = renderHook(() => useCameraGestures({ ...spies, ...options }));
  return { ...view, spies };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCameraGestures", () => {
  describe("double tap to flip", () => {
    it("fires on two quick taps in the same spot", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { t: 0 });
      expect(spies.onDoubleTap).not.toHaveBeenCalled();

      tap(result.current.handlers, { t: 150 });
      expect(spies.onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it("does not fire when the taps are too far apart in time", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { t: 0 });
      tap(result.current.handlers, { t: 900 });

      expect(spies.onDoubleTap).not.toHaveBeenCalled();
    });

    it("does not fire when the second tap lands somewhere else", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { x: 60, y: 300, t: 0 });
      tap(result.current.handlers, { x: 260, y: 300, t: 120 });

      expect(spies.onDoubleTap).not.toHaveBeenCalled();
    });

    it("treats a press that drifts as a drag, not a tap", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { t: 0 });
      tap(result.current.handlers, { t: 120, dx: 40 });

      expect(spies.onDoubleTap).not.toHaveBeenCalled();
    });

    it("needs a third tap after a double tap, so a triple is not two flips", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { t: 0 });
      tap(result.current.handlers, { t: 120 });
      tap(result.current.handlers, { t: 240 });

      expect(spies.onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it("ignores everything while disabled", () => {
      const { result, spies } = setup({ enabled: false });

      tap(result.current.handlers, { t: 0 });
      tap(result.current.handlers, { t: 120 });

      expect(spies.onDoubleTap).not.toHaveBeenCalled();
    });
  });

  describe("pinch to zoom", () => {
    it("reports scale relative to the spread the pinch started at", () => {
      const { result, spies } = setup();
      const h = result.current.handlers;

      act(() => {
        h.onPointerDown(pointer(1, 100, 300, 0));
        h.onPointerDown(pointer(2, 200, 300, 10)); // 100px apart
      });
      expect(spies.onPinchStart).toHaveBeenCalledTimes(1);
      expect(result.current.isPinching).toBe(true);

      act(() => {
        h.onPointerMove(pointer(2, 300, 300, 40)); // now 200px apart
      });
      expect(spies.onPinch).toHaveBeenLastCalledWith(2);

      act(() => {
        h.onPointerMove(pointer(2, 150, 300, 70)); // back to 50px
      });
      expect(spies.onPinch).toHaveBeenLastCalledWith(0.5);

      act(() => {
        h.onPointerUp(pointer(2, 150, 300, 90));
      });
      expect(spies.onPinchEnd).toHaveBeenCalledTimes(1);
      expect(result.current.isPinching).toBe(false);
    });

    it("does not leave a pinch release looking like a tap", () => {
      const { result, spies } = setup();
      const h = result.current.handlers;

      act(() => {
        h.onPointerDown(pointer(1, 100, 300, 0));
        h.onPointerDown(pointer(2, 200, 300, 5));
        h.onPointerUp(pointer(2, 200, 300, 40));
        h.onPointerUp(pointer(1, 100, 300, 50));
      });
      tap(result.current.handlers, { t: 80 });

      expect(spies.onDoubleTap).not.toHaveBeenCalled();
    });
  });

  describe("swipe down to dismiss", () => {
    it("fires on a quick downward flick", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { dy: 140, duration: 200 });

      expect(spies.onSwipeDown).toHaveBeenCalledTimes(1);
    });

    it("ignores a flick that is mostly sideways", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { dy: 140, dx: 160, duration: 200 });

      expect(spies.onSwipeDown).not.toHaveBeenCalled();
    });

    it("ignores an upward drag and a slow one", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { dy: -140, duration: 200 });
      tap(result.current.handlers, { dy: 140, duration: 1500, t: 2000 });

      expect(spies.onSwipeDown).not.toHaveBeenCalled();
    });

    it("ignores a drag too short to be a flick", () => {
      const { result, spies } = setup();

      tap(result.current.handlers, { dy: 40, duration: 200 });

      expect(spies.onSwipeDown).not.toHaveBeenCalled();
    });
  });

  it("drops a gesture that is cancelled rather than released", () => {
    const { result, spies } = setup();
    const h = result.current.handlers;

    act(() => {
      h.onPointerDown(pointer(1, 100, 300, 0));
      h.onPointerCancel(pointer(1, 100, 300, 40));
    });

    expect(spies.onDoubleTap).not.toHaveBeenCalled();
    expect(spies.onSwipeDown).not.toHaveBeenCalled();
  });
});
