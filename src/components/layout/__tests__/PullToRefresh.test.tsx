import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PullToRefresh } from "../PullToRefresh";

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

const originalMatchMedia = window.matchMedia;

/** Installed to the home screen, or not: a browser tab has its own reload. */
function setInstalled(installed: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: installed && query === "(display-mode: standalone)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
}

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

/** A touch as the browser sends it, from the page's point of view. */
function touch(type: "touchstart" | "touchmove" | "touchend", target: Element, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: x, clientY: y, target }],
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** A finger dragged from (x, y) by (dx, dy), then lifted. */
function drag(target: Element, dx: number, dy: number, from = { x: 100, y: 120 }) {
  touch("touchstart", target, from.x, from.y);
  // In steps, as a real drag arrives: the first moves decide its direction.
  for (const t of [0.1, 0.3, 0.6, 1]) {
    touch("touchmove", target, from.x + dx * t, from.y + dy * t);
  }
  touch("touchend", target);
}

/** Far enough down to refresh: (dy - slop) at half pace is past 64px. */
const PULL = 160;

function renderScreen() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <header data-testid="bar">Top bar</header>
      <main>
        <PullToRefresh />
        <section data-testid="page">
          <div data-testid="list">Habits</div>
        </section>
      </main>
      <div data-testid="sheet">A sheet, portaled out of the page</div>
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

describe("PullToRefresh", () => {
  beforeEach(() => {
    routerRefresh.mockClear();
    setInstalled(true);
    setOnline(true);
    setScrollY(0);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    setOnline(true);
    setScrollY(0);
  });

  it("refreshes the screen's data and its server parts on a pull from the top", async () => {
    const { invalidate } = renderScreen();

    drag(screen.getByTestId("page"), 0, PULL);

    expect(invalidate).toHaveBeenCalledWith();
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(""));
  });

  it("does nothing for a pull let go too early", () => {
    const { invalidate } = renderScreen();

    drag(screen.getByTestId("page"), 0, 60);

    expect(invalidate).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("leaves a sideways swipe to the habit's check-in drawer", () => {
    const { invalidate } = renderScreen();

    drag(screen.getByTestId("page"), -120, 40);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("only pulls from the top of the page", () => {
    const { invalidate } = renderScreen();
    setScrollY(240);

    drag(screen.getByTestId("page"), 0, PULL);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("is never pulled from the bar or a sheet, only the page", () => {
    const { invalidate } = renderScreen();

    drag(screen.getByTestId("bar"), 0, PULL);
    drag(screen.getByTestId("sheet"), 0, PULL);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("lets a list of its own scroll back up first", () => {
    const { invalidate } = renderScreen();
    const list = screen.getByTestId("list");
    Object.defineProperty(list, "scrollTop", { value: 80, configurable: true });

    drag(list, 0, PULL);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refetches offline but doesn't reload the server parts, which would land on the offline page", async () => {
    const { invalidate } = renderScreen();
    setOnline(false);

    drag(screen.getByTestId("page"), 0, PULL);

    expect(invalidate).toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(""));
  });

  it("takes over the page's own overscroll while mounted, and gives it back", () => {
    const { unmount } = renderScreen();
    expect(document.documentElement.style.overscrollBehaviorY).toBe("none");

    unmount();
    expect(document.documentElement.style.overscrollBehaviorY).toBe("");
  });

  it("leaves a browser tab alone, which has a pull of its own", () => {
    setInstalled(false);
    const { invalidate } = renderScreen();

    drag(screen.getByTestId("page"), 0, PULL);

    expect(invalidate).not.toHaveBeenCalled();
    expect(document.documentElement.style.overscrollBehaviorY).toBe("");
  });
});
