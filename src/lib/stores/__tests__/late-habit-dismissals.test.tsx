import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LATE_DISMISSED_KEY,
  dismissLateHabits,
  forgetLateHabitDismissals,
  useDismissedLateHabits,
} from "../late-habit-dismissals";

beforeEach(() => {
  localStorage.clear();
  forgetLateHabitDismissals();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("late habit dismissals", () => {
  it("are shared by everything listening, and kept on the device", () => {
    const card = renderHook(() => useDismissedLateHabits());
    const inbox = renderHook(() => useDismissedLateHabits());
    expect(card.result.current?.size).toBe(0);

    act(() => dismissLateHabits(["run:2026-11-07"]));

    expect(card.result.current?.has("run:2026-11-07")).toBe(true);
    expect(inbox.result.current?.has("run:2026-11-07")).toBe(true);
    expect(JSON.parse(localStorage.getItem(LATE_DISMISSED_KEY)!)).toHaveProperty("run:2026-11-07");
  });

  it("forget old ones as new ones come", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1));
    dismissLateHabits(["old:2026-11-01"]);

    vi.setSystemTime(new Date(2026, 10, 7));
    dismissLateHabits(["new:2026-11-07"]);

    const kept = Object.keys(JSON.parse(localStorage.getItem(LATE_DISMISSED_KEY)!));
    expect(kept).toEqual(["new:2026-11-07"]);
  });

  it("are kept for the session when storage refuses them", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const { result } = renderHook(() => useDismissedLateHabits());

    act(() => dismissLateHabits(["run:2026-11-07"]));

    expect(result.current?.has("run:2026-11-07")).toBe(true);
  });

  it("are all forgotten at sign-out", () => {
    const { result } = renderHook(() => useDismissedLateHabits());
    act(() => dismissLateHabits(["run:2026-11-07"]));

    act(() => forgetLateHabitDismissals());

    expect(result.current?.size).toBe(0);
    expect(localStorage.getItem(LATE_DISMISSED_KEY)).toBeNull();
  });
});
