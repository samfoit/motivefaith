import { create } from "zustand";

type Step = "closed" | "camera" | "share" | "uploading";
type CaptureMode = "photo" | "video" | "voice";
export type ShareTarget = "habit" | "friend" | "group";

/**
 * The one chat a capture goes to when the camera is opened from inside it.
 * Skips the "Send to…" picker: the take goes straight to this friend or group,
 * as a camera opened from a Snapchat conversation does.
 */
export interface DirectTarget {
  kind: "friend" | "group";
  id: string;
  /** Shown on the send button: "Send to Sam". */
  name: string;
  /** The chat's own messages arrive by refresh, not realtime. */
  onSent?: () => void;
}

interface QuickCaptureState {
  step: Step;
  captureMode: CaptureMode | null;
  capturedFile: File | null;
  habitIds: string[];
  friendIds: string[];
  groupIds: string[];
  direct: DirectTarget | null;
  open: () => void;
  /** Open the camera to send to one chat only. */
  openTo: (target: DirectTarget) => void;
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
  direct: null,
});

export const useQuickCaptureStore = create<QuickCaptureState>((set) => ({
  ...cleared(),
  // Not a parameter of `open`: that is passed straight to onClick, which
  // would hand it the click event.
  open: () => set({ step: "camera", direct: null }),
  openTo: (target) => set({ step: "camera", direct: target }),
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
