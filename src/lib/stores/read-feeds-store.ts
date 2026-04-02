import { create } from "zustand";

interface ReadFeedsStore {
  /** feedId → timestamp when the user opened that feed */
  readAt: Map<string, number>;
  markRead: (feedId: string) => void;
}

export const useReadFeedsStore = create<ReadFeedsStore>((set) => ({
  readAt: new Map(),
  markRead: (feedId) =>
    set((s) => {
      const next = new Map(s.readAt);
      next.set(feedId, Date.now());
      return { readAt: next };
    }),
}));
