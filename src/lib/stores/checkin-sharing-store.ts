import { create } from "zustand";
import type { AudienceMember } from "@/lib/data/checkin-sharing";

interface SharingQuestion {
  /**
   * Who the check-in goes to, or null when that couldn't be found out —
   * offline, before the app has ever been told.
   */
  audience: AudienceMember[] | null;
}

interface CheckinSharingState {
  /** The question on screen, or null when there is none. */
  question: SharingQuestion | null;
  /** Everyone waiting on the answer. */
  waiting: ((yes: boolean) => void)[];
  /**
   * Put the question up and resolve with the answer. A check-in started while
   * it is already up waits on that same answer rather than asking twice.
   */
  ask: (audience: AudienceMember[] | null) => Promise<boolean>;
  answer: (yes: boolean) => void;
}

export const useCheckinSharingStore = create<CheckinSharingState>(
  (set, get) => ({
    question: null,
    waiting: [],
    ask: (audience) =>
      new Promise<boolean>((resolve) => {
        const { question, waiting } = get();
        set({
          question: question ?? { audience },
          waiting: [...waiting, resolve],
        });
      }),
    answer: (yes) => {
      const { waiting } = get();
      set({ question: null, waiting: [] });
      for (const resolve of waiting) resolve(yes);
    },
  }),
);
