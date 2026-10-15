import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

let pathname = "/main/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { UpdatePrompt } from "../UpdatePrompt";
import { useUpdateStore } from "@/lib/stores/update-store";

function fakeWorker() {
  return { postMessage: vi.fn() } as unknown as ServiceWorker & {
    postMessage: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  pathname = "/main/dashboard";
  useUpdateStore.setState({ waiting: null, dismissed: false });
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

  it("hands over to the waiting worker on Refresh", () => {
    const worker = fakeWorker();
    const addEventListener = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { addEventListener },
    });
    act(() => useUpdateStore.getState().setWaiting(worker));
    render(<UpdatePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));
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
