import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Mock supabase client
const mockSignInWithPassword = vi.fn();
const mockSignInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signInWithOAuth: mockSignInWithOAuth,
    },
  }),
}));

// Mock habit-facts
vi.mock("../habit-facts", () => ({
  DesktopFactsPanel: () => null,
  MobileFactBanner: () => null,
}));

// Mock Turnstile — renders nothing in tests
vi.mock("@/components/ui/Turnstile", () => ({
  Turnstile: () => null,
}));

// Mock useCaptcha
vi.mock("@/lib/hooks/useCaptcha", () => ({
  useCaptcha: () => ({
    captchaToken: null,
    handleToken: vi.fn(),
    handleExpire: vi.fn(),
  }),
}));

// Mock rate limiter — always allow
vi.mock("@/lib/utils/rate-limit-client", () => ({
  checkRateLimitWithToast: vi.fn(() => true),
}));

// Mock Toast
const mockShow = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    show: mockShow,
    remove: vi.fn(),
    ToastElements: null,
  }),
}));

// Mock router
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/navigation")>();
  return {
    ...mod,
    useRouter: () => ({
      push: mockPush,
      refresh: mockRefresh,
      replace: vi.fn(),
      back: vi.fn(),
      prefetch: vi.fn(),
    }),
  };
});

import LoginPage from "../login/page";

beforeEach(() => {
  vi.clearAllMocks();
});

function fillAndSubmit(email = "test@test.com", password = "password123") {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.submit(document.querySelector("form")!);
}

describe("LoginPage", () => {
  it("renders form with Email and Password fields", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it('renders "MotiveFaith" heading, link to signup, forgot password, and Google button', () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "MotiveFaith" })).toBeInTheDocument();
    expect(screen.getByText("Sign up")).toHaveAttribute("href", "/auth/signup");
    expect(screen.getByText("Forgot password?")).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
    expect(screen.getByRole("button", { name: /google/i })).toBeInTheDocument();
  });

  it("calls signInWithPassword on submit", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillAndSubmit("test@test.com", "password123");

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "test@test.com",
        password: "password123",
        options: undefined,
      });
    });
  });

  it("redirects to /main/dashboard on success", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillAndSubmit();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/main/dashboard");
    });
  });

  it("shows error toast on failure", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid credentials" },
    });
    render(<LoginPage />);
    fillAndSubmit("test@test.com", "wrong");

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          description: "Invalid email or password",
        }),
      );
    });
  });

  it("shows error state on password field on failure", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Bad password" },
    });
    render(<LoginPage />);
    fillAndSubmit("test@test.com", "wrong");

    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
  });

  it("shows error message text for password field on failure", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    render(<LoginPage />);
    fillAndSubmit("test@test.com", "wrong");

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    });
  });

  it("button is disabled while loading", async () => {
    mockSignInWithPassword.mockReturnValue(new Promise(() => {}));
    render(<LoginPage />);
    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
    });
  });
});
