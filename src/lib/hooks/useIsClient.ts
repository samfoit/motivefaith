"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards.
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect` flag: it needs
 * no subscription, no state update, and no extra render pass, and it is the
 * hydration-safe way to render something the server cannot know.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
