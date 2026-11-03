import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";

// Mock supabase client
const mockSignUp = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockGetUser = vi.fn();
const mockProfile = vi.fn();
const mockResend = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signUp: mockSignUp,
      signInWithOAuth: mockSignInWithOAuth,
      getUser: mockGetUser,
      resend: mockResend,
    },
    from: () => ({ select: () => ({ eq: () => ({ single: mockProfile }) }) }),
  }),
}));

// Google's own button needs its script and a client ID. What the page does
// once Google has signed someone in is the part under test, so the handler
// it passes is kept to call directly; the real component still renders, as
// its redirect button.
const google = vi.hoisted(() => ({
  onSignedIn: null as null | (() => void | Promise<void>),
}));
vi.mock("../GoogleSignIn", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../GoogleSignIn")>();
  return {
    ...mod,
    GoogleSignIn: (props: ComponentProps<typeof mod.GoogleSignIn>) => {
      google.onSignedIn = props.onSignedIn;
      return <mod.GoogleSignIn {...props} />;
    },
  };
});

// Mock habit-facts to avoid animation complexity
vi.mock("../habit-facts", () => ({
  DesktopFactsPanel: () => null,
  MobileFactBanner: () => null,
}));

// Mock Turnstile — renders nothing in tests
vi.mock("@/components/ui/Turnstile", () => ({
  Turnstile: () => null,
}));

// The captcha, unconfigured, with its reset observable.
const captcha = vi.hoisted(() => ({ reset: (() => {}) as () => void }));
vi.mock("@/lib/hooks/useCaptcha", () => ({
  useCaptcha: () => ({
    captchaToken: null,
    handleToken: () => {},
    handleExpire: () => {},
    reset: captcha.reset,
    resetKey: 0,
    required: false,
  }),
}));

// Mock rate limiter — always allow
vi.mock("@/lib/utils/rate-limit-client", () => ({
  checkClientRateLimit: () => true,
  getRateLimitRetryAfter: () => 0,
}));

// Mock password validation — always pass
vi.mock("@/lib/utils/validate-password", () => ({
  validatePassword: vi.fn(() => null),
}));

// Mock breach check — always clean
vi.mock("@/lib/utils/check-breached-password", () => ({
  isPasswordBreached: vi.fn(async () => false),
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

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.clearAllMocks();
  captcha.reset = vi.fn();
  // A well-formed default response. The page reads `data.session` after a
  // successful call, so a mock that only sets `error` makes it throw after the
  // assertion has already passed — which surfaces as an unhandled rejection
  // rather than a test failure. Individual tests override this.
  mockSignUp.mockResolvedValue({
    data: { session: { access_token: "token" }, user: { id: "u1" } },
    error: null,
  });
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

  it('renders "Create your account" heading and link to login', () => {
    render(<SignupPage />);
    expect(
      screen.getByRole("heading", { name: "Create your account" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sign in")).toHaveAttribute("href", "/auth/login");
    expect(screen.getByRole("link", { name: "MotiveFaith" })).toHaveAttribute("href", "/");
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

  it("says why it can't continue when the terms aren't accepted, instead of a dead button", async () => {
    render(<SignupPage />);
    expect(screen.getByRole("button", { name: /create account/i })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Test User" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "testuser" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "StrongPass123!" } });
    fireEvent.change(screen.getByLabelText("Date of Birth"), { target: { value: "2000-01-15" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      expect(
        screen.getByText("You must agree to the Terms of Service and Privacy Policy"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
    expect(mockSignUp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      screen.queryByText("You must agree to the Terms of Service and Privacy Policy"),
    ).not.toBeInTheDocument();
  });

  it("calls supabase.auth.signUp with correct data on valid submit", async () => {
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
    // A session is returned when email confirmation is not required; without
    // one the page shows the "check your email" screen instead of redirecting.
    mockSignUp.mockResolvedValue({
      data: { session: { access_token: "token" }, user: { id: "u1" } },
      error: null,
    });
    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/auth/onboarding");
    });
  });

  it("surfaces the provider's own message for an unrecognized 4xx failure", async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { name: "AuthApiError", status: 400, message: "Email already in use" },
    });
    render(<SignupPage />);
    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Email already in use");
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

describe("SignupPage when things go wrong", () => {
  it("puts a taken username under the username field and moves the cursor there", async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { name: "AuthRetryableFetchError", status: 500, message: "Database error saving new user" },
    });
    render(<SignupPage />);
    fillAndSubmit();

    expect(await screen.findByText("That username is taken. Try another.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveFocus());
    expect(screen.queryByText(/database error/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeEnabled();
  });

  it("says when the email already has an account, even when Supabase hides it", async () => {
    // With confirmation on, an existing address gets a stand-in user with no identities.
    mockSignUp.mockResolvedValue({
      data: { session: null, user: { id: "x", identities: [] } },
      error: null,
    });
    render(<SignupPage />);
    fillAndSubmit();

    expect(await screen.findByText(/an account with this email already exists/i)).toBeInTheDocument();
    expect(screen.queryByText("Check your email")).not.toBeInTheDocument();
  });

  it("says it can't reach the server when offline, without trying", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<SignupPage />);
    fillAndSubmit();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't reach motivefaith/i);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("recovers when the request throws, and fetches a fresh security token", async () => {
    mockSignUp.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SignupPage />);
    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/check your connection/i);
    expect(screen.getByRole("button", { name: /create account/i })).toBeEnabled();
    expect(captcha.reset).toHaveBeenCalledTimes(1);
  });

  it("rejects a blank display name, a too-long username and a future birthday before sending", async () => {
    render(<SignupPage />);
    fillAndSubmit({ name: "   " });
    expect(screen.getByText("Enter the name your friends will see")).toBeInTheDocument();

    fillAndSubmit({ username: "a".repeat(31) });
    expect(screen.getByText("Username must be 30 characters or fewer")).toBeInTheDocument();

    fillAndSubmit({ dob: "2999-01-01" });
    expect(screen.getByText("Date of birth can't be in the future")).toBeInTheDocument();

    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("drops a pasted @ and stray spaces", async () => {
    render(<SignupPage />);
    fillAndSubmit({ username: "@TestUser", email: " test@example.com " });

    await waitFor(() =>
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "test@example.com",
          options: expect.objectContaining({
            data: expect.objectContaining({ username: "testuser" }),
          }),
        }),
      ),
    );
  });

  it("lets the confirmation email be sent again", async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: { id: "u1", identities: [{}] } },
      error: null,
    });
    mockResend.mockResolvedValue({
      error: { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" },
    });
    render(<SignupPage />);
    fillAndSubmit();

    await screen.findByText("Check your email");
    fireEvent.click(screen.getByRole("button", { name: /resend the confirmation link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/wait a few minutes/i);
    expect(mockResend).toHaveBeenCalledWith({ type: "signup", email: "test@example.com" });
  });
});

describe("SignupPage with Google", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  async function signInWithGoogle() {
    await act(async () => {
      await google.onSignedIn!();
    });
  }

  it("offers Continue with Google, going through Google's redirect where its button can't load", async () => {
    render(<SignupPage />);

    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() =>
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // Google asks which account every time, so a second Gmail can be
          // used, rather than going straight back with the last one.
          queryParams: { prompt: "select_account" },
        },
      }),
    );
  });

  it("sends someone new on to finish their profile, where the age check and terms are", async () => {
    mockProfile.mockResolvedValue({ data: { avatar_url: null, has_date_of_birth: false } });
    render(<SignupPage />);

    await signInWithGoogle();

    expect(mockPush).toHaveBeenCalledWith("/auth/complete-profile");
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("takes someone who already has an account straight in", async () => {
    mockProfile.mockResolvedValue({
      data: { avatar_url: "me.png", has_date_of_birth: true },
    });
    render(<SignupPage />);

    await signInWithGoogle();

    expect(mockPush).toHaveBeenCalledWith("/main/dashboard");
  });
});
