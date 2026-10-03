import { create } from "zustand";

/**
 * Set when this device writes something the feed previews — today, a
 * check-in — and cleared by the feed once it has asked the server again.
 *
 * The feed cannot learn about the viewer's own writes any other way:
 *
 * - Its realtime channel listens for friends' completions, not the viewer's.
 * - A quick check-in is held for an undo window and only sent when the
 *   dashboard unmounts, which on a tab switch is *after* the feed has
 *   already been rendered on the server.
 * - The client router cache (`staleTimes.dynamic`) can hand back a feed
 *   rendered before the write without asking the server at all.
 *
 * A flag rather than a timestamp, so nothing depends on the server and the
 * device agreeing about the time.
 */
interface FeedStaleStore {
  stale: boolean;
  markStale: () => void;
  clearStale: () => void;
}

export const useFeedStaleStore = create<FeedStaleStore>((set) => ({
  stale: false,
  markStale: () => set({ stale: true }),
  clearStale: () => set({ stale: false }),
}));
