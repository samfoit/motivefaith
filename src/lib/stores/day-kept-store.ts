import { create } from "zustand";
import type { DayKept } from "@/lib/day-kept";

/**
 * The day's last habit was just settled, somewhere in the app: the dashboard
 * in any of its views, a habit's own page, or the camera. Whichever it was
 * offers the moment here, and the layout's one <DayKeptMoment> plays it, so
 * the reward is the same wherever the day was finished.
 *
 * `id` tells one offer from the next, so the moment restarts rather than
 * carries on if the day is un-kept and kept again (an undo, then the same
 * tap).
 */
interface DayKeptStore {
  moment: (DayKept & { id: number }) | null;
  offer: (kept: DayKept) => void;
  /** Take it down — it was tapped away, it ran out, or the check-in was undone. */
  dismiss: () => void;
}

let nextId = 1;

export const useDayKeptStore = create<DayKeptStore>((set) => ({
  moment: null,
  offer: (kept) => set({ moment: { ...kept, id: nextId++ } }),
  dismiss: () => set({ moment: null }),
}));
