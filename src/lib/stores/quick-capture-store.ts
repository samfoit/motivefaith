import { create } from "zustand";

type Step = "closed" | "camera" | "share" | "uploading";
type CaptureMode = "photo" | "video" | "voice";
export type ShareTarget = "habit" | "friend" | "group";

interface QuickCaptureState {
  step: Step;
  captureMode: CaptureMode | null;
  capturedFile: File | null;
  habitIds: string[];
  friendIds: string[];
  groupIds: string[];
  open: () => void;
  close: () => void;
  reset: () => void;
  setCapturedFile: (file: File) => void;
  /** Back from the send screen to the full-size preview, keeping everything. */
  backToPreview: () => void;
  setStep: (step: Step) => void;
  toggleTarget: (target: ShareTarget, id: string) => void;
  /** Unpick these, e.g. ones a picked habit's check-in now reaches anyway. */
  deselectTargets: (target: ShareTarget, ids: Iterable<string>) => void;
}

const TARGET_KEY = {
  habit: "habitIds",
  friend: "friendIds",
  group: "groupIds",
} as const;

// Fresh arrays each time, so a closed flow never shares a selection with the
// next one.
const cleared = () => ({
  step: "closed" as const,
  captureMode: null,
  capturedFile: null,
  habitIds: [],
  friendIds: [],
  groupIds: [],
});

export const useQuickCaptureStore = create<QuickCaptureState>((set) => ({
  ...cleared(),
  open: () => set({ step: "camera" }),
  close: () => set(cleared()),
  reset: () => set(cleared()),
  setCapturedFile: (file) => set({ capturedFile: file, step: "share" }),
  backToPreview: () => set({ step: "camera" }),
  setStep: (step) => set({ step }),
  toggleTarget: (target, id) =>
    set((s) => {
      const key = TARGET_KEY[target];
      const ids = s[key];
      return {
        [key]: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      };
    }),
  deselectTargets: (target, ids) =>
    set((s) => {
      const drop = new Set(ids);
      const key = TARGET_KEY[target];
      return { [key]: s[key].filter((x) => !drop.has(x)) };
    }),
}));
