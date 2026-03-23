import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// We need to override usePathname per-test, so mock it with a ref
const mockPathname = vi.fn().mockReturnValue("/main/dashboard");
vi.mock("next/navigation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/navigation")>();
  return { ...mod, usePathname: () => mockPathname() };
});

// Mock the quick capture store
const mockOpen = vi.fn();
vi.mock("@/lib/stores/quick-capture-store", () => ({
  useQuickCaptureStore: (selector: (s: { open: () => void }) => unknown) =>
    selector({ open: mockOpen }),
}));

import { BottomNav } from "../BottomNav";

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.mockReturnValue("/main/dashboard");
});

describe("BottomNav", () => {
  it("renders 5 nav items", () => {
    render(<BottomNav />);
    // 4 links + 1 button (Capture)
    const nav = screen.getByRole("navigation");
    const links = nav.querySelectorAll("a");
    const buttons = nav.querySelectorAll("button");
    expect(links.length + buttons.length).toBe(5);
  });

  it("nav has aria-label 'Main navigation'", () => {
    render(<BottomNav />);
    expect(screen.getByRole("navigation")).toHaveAttribute(
      "aria-label",
      "Main navigation",
    );
  });

  it("renders Home, Feed, Capture, Friends, Profile", () => {
    render(<BottomNav />);
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Feed")).toBeInTheDocument();
    expect(screen.getByLabelText("Capture")).toBeInTheDocument();
    expect(screen.getByText("Friends")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
  });

  it("highlights correct item based on pathname (dashboard)", () => {
    mockPathname.mockReturnValue("/main/dashboard");
    render(<BottomNav />);
    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink).toHaveAttribute("aria-current", "page");
  });

  it("highlights Feed when pathname is /main/feed", () => {
    mockPathname.mockReturnValue("/main/feed");
    render(<BottomNav />);
    const feedLink = screen.getByText("Feed").closest("a");
    expect(feedLink).toHaveAttribute("aria-current", "page");
  });

  it("Capture button calls openCapture from Zustand store", async () => {
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByLabelText("Capture"));
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("nav links have correct href attributes", () => {
    render(<BottomNav />);
    expect(screen.getByText("Home").closest("a")).toHaveAttribute(
      "href",
      "/main/dashboard",
    );
    expect(screen.getByText("Feed").closest("a")).toHaveAttribute(
      "href",
      "/main/feed",
    );
    expect(screen.getByText("Friends").closest("a")).toHaveAttribute(
      "href",
      "/main/friends",
    );
    expect(screen.getByText("Profile").closest("a")).toHaveAttribute(
      "href",
      "/main/profile",
    );
  });

  it("aria-current=page on active link only", () => {
    mockPathname.mockReturnValue("/main/friends");
    render(<BottomNav />);
    const friendsLink = screen.getByText("Friends").closest("a");
    const homeLink = screen.getByText("Home").closest("a");
    expect(friendsLink).toHaveAttribute("aria-current", "page");
    expect(homeLink).not.toHaveAttribute("aria-current");
  });

  it("no aria-current on any link when pathname does not match", () => {
    mockPathname.mockReturnValue("/auth/login");
    render(<BottomNav />);
    const nav = screen.getByRole("navigation");
    const activateLinks = nav.querySelectorAll("[aria-current]");
    expect(activateLinks.length).toBe(0);
  });

  it("Capture button does not render as a link", () => {
    render(<BottomNav />);
    const captureBtn = screen.getByLabelText("Capture");
    expect(captureBtn.tagName).toBe("BUTTON");
    expect(captureBtn).not.toHaveAttribute("href");
  });
});
