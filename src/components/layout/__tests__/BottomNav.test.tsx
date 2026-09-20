import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

// BottomNav reads the signed-in user id to decide whether to show its unread
// badges. Stub the client so the hook resolves to "signed out" rather than
// reaching for real credentials; the badge queries are `enabled: !!userId`, so
// they stay idle and these tests exercise the nav structure itself.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

import { BottomNav } from "../BottomNav";

/**
 * BottomNav calls `useQueryClient()`, so it can only render beneath a
 * provider. A fresh QueryClient per render keeps tests isolated, and retries
 * are off so a failing query surfaces immediately instead of being retried.
 */
function renderNav() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BottomNav />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.mockReturnValue("/main/dashboard");
});

describe("BottomNav", () => {
  it("renders 5 nav items", () => {
    renderNav();
    // 4 links + 1 button (Capture)
    const nav = screen.getByRole("navigation");
    const links = nav.querySelectorAll("a");
    const buttons = nav.querySelectorAll("button");
    expect(links.length + buttons.length).toBe(5);
  });

  it("nav has aria-label 'Main navigation'", () => {
    renderNav();
    expect(screen.getByRole("navigation")).toHaveAttribute(
      "aria-label",
      "Main navigation",
    );
  });

  it("renders Home, Feed, Capture, Friends, Profile", () => {
    renderNav();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Feed")).toBeInTheDocument();
    expect(screen.getByLabelText("Capture")).toBeInTheDocument();
    expect(screen.getByText("Friends")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
  });

  it("highlights correct item based on pathname (dashboard)", () => {
    mockPathname.mockReturnValue("/main/dashboard");
    renderNav();
    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink).toHaveAttribute("aria-current", "page");
  });

  it("highlights Feed when pathname is /main/feed", () => {
    mockPathname.mockReturnValue("/main/feed");
    renderNav();
    const feedLink = screen.getByText("Feed").closest("a");
    expect(feedLink).toHaveAttribute("aria-current", "page");
  });

  it("Capture button calls openCapture from Zustand store", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByLabelText("Capture"));
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("nav links have correct href attributes", () => {
    renderNav();
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
    renderNav();
    const friendsLink = screen.getByText("Friends").closest("a");
    const homeLink = screen.getByText("Home").closest("a");
    expect(friendsLink).toHaveAttribute("aria-current", "page");
    expect(homeLink).not.toHaveAttribute("aria-current");
  });

  it("no aria-current on any link when pathname does not match", () => {
    mockPathname.mockReturnValue("/auth/login");
    renderNav();
    const nav = screen.getByRole("navigation");
    const activateLinks = nav.querySelectorAll("[aria-current]");
    expect(activateLinks.length).toBe(0);
  });

  it("Capture button does not render as a link", () => {
    renderNav();
    const captureBtn = screen.getByLabelText("Capture");
    expect(captureBtn.tagName).toBe("BUTTON");
    expect(captureBtn).not.toHaveAttribute("href");
  });
});
