import { describe, it, expect, beforeEach } from "vitest";
import { useQuickCaptureStore } from "../quick-capture-store";

beforeEach(() => {
  // Reset to initial state between tests
  useQuickCaptureStore.setState({
    step: "closed",
    captureMode: null,
    capturedFile: null,
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

  it("setCapturedFile stores file and advances step to habit-select", () => {
    const file = new File(["content"], "photo.jpg", { type: "image/jpeg" });
    useQuickCaptureStore.getState().setCapturedFile(file);
    const state = useQuickCaptureStore.getState();
    expect(state.capturedFile).toBe(file);
    expect(state.step).toBe("habit-select");
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
    expect(store.getState().step).toBe("habit-select");
    expect(store.getState().capturedFile).toBe(file);

    store.getState().close();
    expect(store.getState().step).toBe("closed");
    expect(store.getState().capturedFile).toBeNull();
  });
});
