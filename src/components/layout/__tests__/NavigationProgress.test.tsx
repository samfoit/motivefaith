import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const mockPathname = vi.fn().mockReturnValue("/main/dashboard");
vi.mock("next/navigation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/navigation")>();
  return { ...mod, usePathname: () => mockPathname() };
});

import { NavigationProgress } from "../NavigationProgress";

/** Click an in-page anchor the way the capture-phase document listener sees it. */
function clickLink(href: string) {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  document.body.appendChild(a);
  act(() => {
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  return a;
}

const bar = () => screen.queryByRole("progressbar");

describe("NavigationProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPathname.mockReturnValue("/main/dashboard");
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("stays hidden for a navigation that resolves faster than the delay", () => {
    const { rerender } = render(<NavigationProgress />);
    clickLink("/main/friends");

    // Arrive before the 120ms threshold — an instant, prefetched navigation.
    act(() => {
      vi.advanceTimersByTime(80);
    });
    mockPathname.mockReturnValue("/main/friends");
    rerender(<NavigationProgress />);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(bar()).not.toBeInTheDocument();
  });

  it("shows the bar once a navigation outlasts the delay", () => {
    render(<NavigationProgress />);
    expect(bar()).not.toBeInTheDocument();

    clickLink("/main/friends");
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(bar()).toBeInTheDocument();
  });

  it("clears the bar when the route actually changes", () => {
    const { rerender } = render(<NavigationProgress />);
    clickLink("/main/friends");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bar()).toBeInTheDocument();

    mockPathname.mockReturnValue("/main/friends");
    rerender(<NavigationProgress />);
    expect(bar()).not.toBeInTheDocument();
  });

  it("ignores clicks that do not start a navigation", () => {
    render(<NavigationProgress />);

    clickLink("#section"); // in-page anchor
    clickLink("mailto:someone@example.com");
    clickLink("https://example.com/external");
    clickLink("/main/dashboard"); // already here

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(bar()).not.toBeInTheDocument();
  });

  it("does not light the bar when the user returns to the page a navigation started from", () => {
    const { rerender } = render(<NavigationProgress />);

    // A slow navigation away from /main/dashboard records it as the origin.
    clickLink("/main/feed");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bar()).toBeInTheDocument();

    mockPathname.mockReturnValue("/main/feed");
    rerender(<NavigationProgress />);
    expect(bar()).not.toBeInTheDocument();

    // Back to /main/dashboard via the browser back button: no click, so
    // nothing new is pending and no timer exists to take a bar down again.
    mockPathname.mockReturnValue("/main/dashboard");
    rerender(<NavigationProgress />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(bar()).not.toBeInTheDocument();
  });

  it("does not light the bar when a return trip resolves inside the delay", () => {
    const { rerender } = render(<NavigationProgress />);

    clickLink("/main/feed");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    mockPathname.mockReturnValue("/main/feed");
    rerender(<NavigationProgress />);

    // Prefetched trip home: arrives before the 120ms threshold.
    clickLink("/main/dashboard");
    act(() => {
      vi.advanceTimersByTime(80);
    });
    mockPathname.mockReturnValue("/main/dashboard");
    rerender(<NavigationProgress />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(bar()).not.toBeInTheDocument();
  });

  it("does not resurrect the bar after arriving, when a later click is still pending", () => {
    const { rerender } = render(<NavigationProgress />);

    clickLink("/main/friends");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    mockPathname.mockReturnValue("/main/friends");
    rerender(<NavigationProgress />);
    expect(bar()).not.toBeInTheDocument();

    // A second, fast navigation from the new page must not flash the bar.
    clickLink("/main/profile");
    act(() => {
      vi.advanceTimersByTime(80);
    });
    mockPathname.mockReturnValue("/main/profile");
    rerender(<NavigationProgress />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(bar()).not.toBeInTheDocument();
  });
});
