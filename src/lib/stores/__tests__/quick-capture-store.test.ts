import { describe, it, expect, beforeEach } from "vitest";
import { useQuickCaptureStore } from "../quick-capture-store";

beforeEach(() => {
  // Reset to initial state between tests
  useQuickCaptureStore.setState({
    step: "closed",
    captureMode: null,
    capturedFile: null,
    habitIds: [],
    friendIds: [],
    groupIds: [],
  });
});

describe("useQuickCaptureStore", () => {
  it("starts in closed state with null captureMode and capturedFile", () => {
    const state = useQuickCaptureStore.getState();
    expect(state.step).toBe("closed");
    expect(state.captureMode).toBeNull();
    expect(state.capturedFile).toBeNull();
  });

  it("open() sets step to camera", () => {
    useQuickCaptureStore.getState().open();
    expect(useQuickCaptureStore.getState().step).toBe("camera");
  });

  it("close() resets step to closed and clears captureMode and capturedFile", () => {
    useQuickCaptureStore.setState({
      step: "camera",
      captureMode: "photo",
      capturedFile: new File([""], "test.jpg"),
    });
    useQuickCaptureStore.getState().close();
    const state = useQuickCaptureStore.getState();
    expect(state.step).toBe("closed");
    expect(state.captureMode).toBeNull();
    expect(state.capturedFile).toBeNull();
  });

  it("reset() same behavior as close", () => {
    useQuickCaptureStore.setState({
      step: "uploading",
      captureMode: "video",
      capturedFile: new File([""], "vid.mp4"),
    });
    useQuickCaptureStore.getState().reset();
    const state = useQuickCaptureStore.getState();
    expect(state.step).toBe("closed");
    expect(state.captureMode).toBeNull();
    expect(state.capturedFile).toBeNull();
  });

  it("setCapturedFile stores file and advances step to share", () => {
    const file = new File(["content"], "photo.jpg", { type: "image/jpeg" });
    useQuickCaptureStore.getState().setCapturedFile(file);
    const state = useQuickCaptureStore.getState();
    expect(state.capturedFile).toBe(file);
    expect(state.step).toBe("share");
  });

  it("setStep changes step directly", () => {
    useQuickCaptureStore.getState().setStep("uploading");
    expect(useQuickCaptureStore.getState().step).toBe("uploading");
  });

  it("full workflow: open → setCapturedFile → close", () => {
    const store = useQuickCaptureStore;
    store.getState().open();
    expect(store.getState().step).toBe("camera");

    const file = new File(["data"], "pic.png");
    store.getState().setCapturedFile(file);
    expect(store.getState().step).toBe("share");
    expect(store.getState().capturedFile).toBe(file);

    store.getState().close();
    expect(store.getState().step).toBe("closed");
    expect(store.getState().capturedFile).toBeNull();
  });

  it("toggleTarget adds and removes ids per destination kind", () => {
    const { toggleTarget } = useQuickCaptureStore.getState();
    toggleTarget("habit", "h1");
    toggleTarget("habit", "h2");
    toggleTarget("friend", "f1");
    toggleTarget("group", "g1");
    toggleTarget("habit", "h1");

    const state = useQuickCaptureStore.getState();
    expect(state.habitIds).toEqual(["h2"]);
    expect(state.friendIds).toEqual(["f1"]);
    expect(state.groupIds).toEqual(["g1"]);
  });

  it("close() and reset() clear the selection", () => {
    const { toggleTarget } = useQuickCaptureStore.getState();
    toggleTarget("habit", "h1");
    toggleTarget("friend", "f1");
    useQuickCaptureStore.getState().close();
    expect(useQuickCaptureStore.getState().habitIds).toEqual([]);
    expect(useQuickCaptureStore.getState().friendIds).toEqual([]);

    toggleTarget("group", "g1");
    useQuickCaptureStore.getState().reset();
    expect(useQuickCaptureStore.getState().groupIds).toEqual([]);
  });
});
