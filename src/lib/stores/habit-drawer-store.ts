import { create } from "zustand";

interface HabitDrawerState {
  /** Habit id whose check-in drawer is open — at most one at a time. */
  openHabitId: string | null;
  open: (habitId: string) => void;
  /** Closes the drawer, but only if `habitId` still owns it. */
  close: (habitId: string) => void;
}

/**
 * Which habit card has its check-in drawer slid open.
 *
 * Lifted out of the cards themselves so opening one closes any other without
 * threading state through DayView — and because each card subscribes with an
 * equality-checked selector, opening a drawer re-renders only the two cards
 * whose state actually changed.
 */
export const useHabitDrawerStore = create<HabitDrawerState>((set) => ({
  openHabitId: null,
  open: (habitId) => set({ openHabitId: habitId }),
  close: (habitId) =>
    set((s) => (s.openHabitId === habitId ? { openHabitId: null } : s)),
}));
