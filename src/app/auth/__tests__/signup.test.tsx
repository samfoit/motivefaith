import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Mock supabase client
const mockSignUp = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signUp: mockSignUp },
  }),
}));

// Mock habit-facts to avoid animation complexity
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

// Mock password validation — always pass
vi.mock("@/lib/utils/validate-password", () => ({
  validatePassword: vi.fn(() => null),
}));

// Mock breach check — always clean
vi.mock("@/lib/utils/check-breached-password", () => ({
  isPasswordBreached: vi.fn(async () => false),
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

import SignupPage from "../signup/page";

beforeEach(() => {
  vi.clearAllMocks();
});

function fillAndSubmit(overrides: Partial<Record<"name" | "username" | "email" | "password" | "dob", string>> = {}) {
  const name = overrides.name ?? "Test User";
  const username = overrides.username ?? "testuser";
  const email = overrides.email ?? "test@example.com";
  const password = overrides.password ?? "StrongPass123!";
  const dob = overrides.dob ?? "2000-01-15";

  fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Date of Birth"), { target: { value: dob } });

  // Accept TOS
  const checkbox = screen.getByRole("checkbox");
  if (!(checkbox as HTMLInputElement).checked) {
    fireEvent.click(checkbox);
  }

  fireEvent.submit(document.querySelector("form")!);
}

describe("SignupPage", () => {
  it("renders form with Display Name, Username, Email, Password fields", () => {
    render(<SignupPage />);
    expect(screen.getByLabelText("Display Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it('renders "Create Account" heading and link to login', () => {
    render(<SignupPage />);
    expect(
      screen.getByRole("heading", { name: "Create Account" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sign in")).toHaveAttribute("href", "/auth/login");
  });

  it("shows error for username < 3 chars", async () => {
    render(<SignupPage />);
    fillAndSubmit({ username: "ab" });
    await waitFor(() => {
      expect(
        screen.getByText("Username must be at least 3 characters"),
      ).toBeInTheDocument();
    });
  });

  it("shows error for invalid username characters", async () => {
    render(<SignupPage />);
    fillAndSubmit({ username: "bad user" });
    await waitFor(() => {
      expect(
        screen.getByText("Only letters, numbers, and underscores allowed"),
      ).toBeInTheDocument();
    });
  });

  it("calls supabase.auth.signUp with correct data on valid submit", async () => {
    mockSignUp.mockResolvedValue({ error: null });
    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "StrongPass123!",
        options: expect.objectContaining({
          data: expect.objectContaining({
            display_name: "Test User",
            username: "testuser",
            date_of_birth: "2000-01-15",
          }),
        }),
      });
    });
  });

  it("redirects to /auth/onboarding on success", async () => {
    mockSignUp.mockResolvedValue({ error: null });
    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/auth/onboarding");
    });
  });

  it("shows error toast on signup failure", async () => {
    mockSignUp.mockResolvedValue({
      error: { message: "Email already in use" },
    });
    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          description: "Could not create account. Please try again.",
        }),
      );
    });
  });

  it("button is disabled while loading", async () => {
    mockSignUp.mockReturnValue(new Promise(() => {}));
    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /create account/i }),
      ).toBeDisabled();
    });
  });
});
