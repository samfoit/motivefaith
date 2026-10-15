import { create } from "zustand";

/**
 * A new service worker that has installed and is waiting to take over.
 *
 * useServiceWorker() puts it here; UpdatePrompt offers the refresh. Kept apart
 * so the prompt can be a quiet banner in the app's own style instead of a
 * window.confirm() that froze the page mid-task.
 */
interface UpdateState {
  waiting: ServiceWorker | null;
  /** "Later" hides the banner for this page's life; the worker keeps waiting. */
  dismissed: boolean;
  setWaiting: (worker: ServiceWorker | null) => void;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  waiting: null,
  dismissed: false,
  setWaiting: (worker) => set({ waiting: worker, dismissed: false }),
  dismiss: () => set({ dismissed: true }),
}));

/**
 * Hand over to the waiting worker, then reload once it controls the page so
 * the old and new versions never run side by side.
 */
export function applyUpdate() {
  const { waiting } = useUpdateStore.getState();
  if (!waiting || typeof navigator === "undefined") return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  waiting.postMessage({ type: "SKIP_WAITING" });
}
