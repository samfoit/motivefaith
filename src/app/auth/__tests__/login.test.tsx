import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Mock supabase client
const mockSignInWithPassword = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockResend = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signInWithOAuth: mockSignInWithOAuth,
      resend: mockResend,
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

// The captcha, as configured or not, with its reset observable.
const captcha = vi.hoisted(() => ({
  token: null as string | null,
  required: false,
  reset: (() => {}) as () => void,
}));
vi.mock("@/lib/hooks/useCaptcha", () => ({
  useCaptcha: () => ({
    captchaToken: captcha.token,
    handleToken: () => {},
    handleExpire: () => {},
    reset: captcha.reset,
    resetKey: 0,
    required: captcha.required,
  }),
}));

// Rate limiter — allows unless a test says otherwise.
const rateLimit = vi.hoisted(() => ({ allow: true }));
vi.mock("@/lib/utils/rate-limit-client", () => ({
  checkClientRateLimit: () => rateLimit.allow,
  getRateLimitRetryAfter: () => 42,
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

// The installed app's redirect leaves for Google; what matters here is
// which redirect the button starts.
const mockStartGoogleRedirect = vi.fn();
vi.mock("../google-redirect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../google-redirect")>()),
  startGoogleRedirect: (clientId: string) => mockStartGoogleRedirect(clientId),
}));

import LoginPage from "../login/page";

const INVALID = {
  error: { name: "AuthApiError", status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
};

beforeEach(() => {
  vi.clearAllMocks();
  captcha.token = null;
  captcha.required = false;
  captcha.reset = vi.fn();
  rateLimit.allow = true;
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('renders "Welcome back" heading, home link, link to signup, forgot password, and Google button', () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MotiveFaith" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Sign up")).toHaveAttribute("href", "/auth/signup");
    expect(screen.getByText("Forgot password?")).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
    expect(screen.getByRole("button", { name: /google/i })).toBeInTheDocument();
  });

  it("calls signInWithPassword on submit, without stray spaces in the email", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillAndSubmit("  test@test.com ", "password123");

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

  it("marks both fields and says which pair failed on wrong credentials", async () => {
    mockSignInWithPassword.mockResolvedValue(INVALID);
    render(<LoginPage />);
    fillAndSubmit("test@test.com", "wrong");

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the error once either field is edited", async () => {
    mockSignInWithPassword.mockResolvedValue(INVALID);
    render(<LoginPage />);
    fillAndSubmit("test@test.com", "wrong");
    await screen.findByText("Invalid email or password");

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong2" } });
    expect(screen.queryByText("Invalid email or password")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
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

describe("LoginPage when things go wrong", () => {
  it("names a missing field instead of sending an empty form", () => {
    render(<LoginPage />);
    fillAndSubmit("", "");
    expect(screen.getByText("Enter your email")).toBeInTheDocument();
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("says it can't reach the server when offline, without trying", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<LoginPage />);
    fillAndSubmit();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't reach motivefaith/i);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("reports a dropped connection as one, not as a wrong password, and lets them retry", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" },
    });
    render(<LoginPage />);
    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/check your connection/i);
    expect(screen.queryByText("Invalid email or password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });

  it("recovers when the request itself throws", async () => {
    mockSignInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<LoginPage />);
    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/check your connection/i);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });

  it("fetches a fresh security token after every failed attempt, since each works once", async () => {
    mockSignInWithPassword.mockResolvedValue(INVALID);
    render(<LoginPage />);
    fillAndSubmit();
    await screen.findByText("Invalid email or password");
    expect(captcha.reset).toHaveBeenCalledTimes(1);
  });

  it("waits for the security check rather than sending without it", () => {
    captcha.required = true;
    render(<LoginPage />);
    fillAndSubmit();
    expect(screen.getByRole("alert")).toHaveTextContent(/security check hasn't finished/i);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("says how long to wait when rate-limited", () => {
    rateLimit.allow = false;
    render(<LoginPage />);
    fillAndSubmit();
    expect(screen.getByRole("alert")).toHaveTextContent("Please wait 42s");
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("offers to resend the link when the email was never confirmed", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { name: "AuthApiError", status: 400, code: "email_not_confirmed", message: "Email not confirmed" },
    });
    mockResend.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillAndSubmit("new@test.com", "password123");

    expect(await screen.findByRole("alert")).toHaveTextContent(/confirm your email first/i);
    fireEvent.click(screen.getByRole("button", { name: /resend the confirmation link/i }));

    await waitFor(() =>
      expect(mockResend).toHaveBeenCalledWith({ type: "signup", email: "new@test.com" }),
    );
    expect(await screen.findByRole("button", { name: /sent/i })).toBeDisabled();
  });
});

describe("LoginPage notices from the query string", () => {
  function renderAt(search: string) {
    window.history.replaceState(null, "", `/auth/login${search}`);
    render(<LoginPage />);
  }

  afterEach(() => window.history.replaceState(null, "", "/"));

  it("confirms a deleted account", () => {
    renderAt("?deleted=1");
    expect(screen.getByRole("status")).toHaveTextContent("Your account has been deleted.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a session whose account data is gone", () => {
    renderAt("?stale=1");
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
  });

  it("shows neither on a plain visit", () => {
    renderAt("");
    expect(screen.queryByText("Your account has been deleted.")).not.toBeInTheDocument();
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  });
});

describe("LoginPage with Google in the installed app", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client-123.apps.googleusercontent.com");
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(window.navigator, "standalone");
  });

  it("signs in through Google by a redirect back to this site, so Google names it rather than Supabase", async () => {
    render(<LoginPage />);

    fireEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() =>
      expect(mockStartGoogleRedirect).toHaveBeenCalledWith("client-123.apps.googleusercontent.com"),
    );
    expect(mockSignInWithOAuth).not.toHaveBeenCalled();
  });
});
