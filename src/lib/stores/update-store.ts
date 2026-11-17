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
  /** Refresh was tapped and the page is on its way to reloading. */
  applying: boolean;
  setWaiting: (worker: ServiceWorker | null) => void;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  waiting: null,
  dismissed: false,
  applying: false,
  setWaiting: (worker) => set({ waiting: worker, dismissed: false }),
  dismiss: () => set({ dismissed: true }),
}));

/** The reload itself, behind a seam: jsdom's `location` can't be spied on. */
export const updatePage = {
  reload: () => window.location.reload(),
};

/**
 * How long Refresh waits for the new worker to take over before reloading
 * regardless. Taking over is normally well under a second, but it is the
 * browser's to grant: it holds the new worker back while the old one is still
 * answering a request, and a tap must never be left with nothing happening.
 */
export const TAKEOVER_TIMEOUT_MS = 4000;

/**
 * Hand over to the waiting worker, then reload once it controls the page so
 * the old and new versions never run side by side.
 *
 * Every path out of here ends in a reload. The worker this page was told
 * about may not be waiting any more: Refresh in another tab or window already
 * activated it, and this one was left showing a banner whose button messaged
 * a worker with nothing left to hand over, so no `controllerchange` ever came
 * and nothing happened however often it was tapped. So ask the registration
 * what is waiting now instead of trusting the stored reference, and reload
 * straight away when nothing is.
 */
export function applyUpdate() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const { waiting, applying } = useUpdateStore.getState();
  if (!waiting || applying) return;
  useUpdateStore.setState({ applying: true });

  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    updatePage.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", reload);
  setTimeout(reload, TAKEOVER_TIMEOUT_MS);

  navigator.serviceWorker
    .getRegistration()
    .then((registration) => {
      const current = registration?.waiting;
      if (!current) {
        reload();
        return;
      }
      current.postMessage({ type: "SKIP_WAITING" });
    })
    .catch(reload);
}
