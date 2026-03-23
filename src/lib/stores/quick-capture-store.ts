import { create } from "zustand";

type Step = "closed" | "camera" | "habit-select" | "uploading";
type CaptureMode = "photo" | "video";

interface QuickCaptureState {
  step: Step;
  captureMode: CaptureMode | null;
  capturedFile: File | null;
  open: () => void;
  close: () => void;
  reset: () => void;
  setCapturedFile: (file: File) => void;
  setStep: (step: Step) => void;
}

export const useQuickCaptureStore = create<QuickCaptureState>((set) => ({
  step: "closed",
  captureMode: null,
  capturedFile: null,
  open: () => set({ step: "camera" }),
  close: () => set({ step: "closed", captureMode: null, capturedFile: null }),
  reset: () => set({ step: "closed", captureMode: null, capturedFile: null }),
  setCapturedFile: (file) => set({ capturedFile: file, step: "habit-select" }),
  setStep: (step) => set({ step }),
}));
