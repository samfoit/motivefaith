import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

let pathname = "/main/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { UpdatePrompt } from "../UpdatePrompt";
import { useUpdateStore, updatePage, TAKEOVER_TIMEOUT_MS } from "@/lib/stores/update-store";

function fakeWorker() {
  return { postMessage: vi.fn() } as unknown as ServiceWorker & {
    postMessage: ReturnType<typeof vi.fn>;
  };
}

/**
 * `navigator.serviceWorker` as the page sees it: the registration reports
 * whichever worker is waiting *now*, which is not always the one the banner
 * was raised for.
 */
function fakeServiceWorker(waitingNow: ServiceWorker | null) {
  const listeners: Record<string, () => void> = {};
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      addEventListener: (type: string, listener: () => void) => {
        listeners[type] = listener;
      },
      getRegistration: async () => ({ waiting: waitingNow }),
    },
  });
  return { controllerChanged: () => listeners.controllerchange?.() };
}

let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  pathname = "/main/dashboard";
  useUpdateStore.setState({ waiting: null, dismissed: false, applying: false });
  reload = vi.spyOn(updatePage, "reload").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("UpdatePrompt", () => {
  it("shows nothing until a new version is waiting", () => {
    const { container } = render(<UpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the waiting version as a banner, not a blocking dialog", () => {
    const confirm = vi.spyOn(window, "confirm");
    act(() => useUpdateStore.getState().setWaiting(fakeWorker()));
    render(<UpdatePrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("A new version of MotiveFaith is ready.");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("hands over to the waiting worker on Refresh, and reloads once it has taken over", async () => {
    const worker = fakeWorker();
    const sw = fakeServiceWorker(worker);
    act(() => useUpdateStore.getState().setWaiting(worker));
    render(<UpdatePrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled();

    sw.controllerChanged();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads straight away when another tab has already applied the update", async () => {
    // The banner is still up for a worker that stopped waiting: Refresh in
    // another tab activated it. Messaging it changes nothing, so no
    // controllerchange comes — the button used to do nothing at all.
    const worker = fakeWorker();
    fakeServiceWorker(null);
    act(() => useUpdateStore.getState().setWaiting(worker));
    render(<UpdatePrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("messages the worker that is waiting now, not a superseded one", async () => {
    const stale = fakeWorker();
    const current = fakeWorker();
    fakeServiceWorker(current);
    act(() => useUpdateStore.getState().setWaiting(stale));
    render(<UpdatePrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });
    expect(current.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(stale.postMessage).not.toHaveBeenCalled();
  });

  it("reloads anyway when the new worker never takes over", async () => {
    vi.useFakeTimers();
    const worker = fakeWorker();
    fakeServiceWorker(worker);
    act(() => useUpdateStore.getState().setWaiting(worker));
    render(<UpdatePrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(TAKEOVER_TIMEOUT_MS);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the tap landed, and takes it only once", async () => {
    const worker = fakeWorker();
    fakeServiceWorker(worker);
    act(() => useUpdateStore.getState().setWaiting(worker));
    render(<UpdatePrompt />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });
    const button = screen.getByRole("button", { name: "Refreshing…" });
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it("hides on Later without activating the update", () => {
    const worker = fakeWorker();
    act(() => useUpdateStore.getState().setWaiting(worker));
    render(<UpdatePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("stays out of auth flows", () => {
    pathname = "/auth/reset-password";
    act(() => useUpdateStore.getState().setWaiting(fakeWorker()));
    const { container } = render(<UpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it("drops in from the top on a chat screen, clear of the composer", () => {
    pathname = "/main/feed/b2222222-2222-2222-2222-222222222222";
    act(() => useUpdateStore.getState().setWaiting(fakeWorker()));
    render(<UpdatePrompt />);
    const banner = screen.getByRole("status");
    expect(banner.className).toContain("top-16");
    expect(banner.className).not.toContain("bottom-");
  });
});
