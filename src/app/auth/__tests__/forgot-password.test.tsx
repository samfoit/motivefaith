import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockResetPasswordForEmail = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { resetPasswordForEmail: mockResetPasswordForEmail } }),
}));

vi.mock("@/components/ui/Turnstile", () => ({
  Turnstile: () => null,
}));

const captcha = vi.hoisted(() => ({ reset: (() => {}) as () => void }));
vi.mock("@/lib/hooks/useCaptcha", () => ({
  useCaptcha: () => ({
    captchaToken: "token-1",
    handleToken: () => {},
    handleExpire: () => {},
    reset: captcha.reset,
    resetKey: 0,
    required: true,
  }),
}));

vi.mock("@/lib/utils/rate-limit-client", () => ({
  checkRateLimitWithToast: () => true,
}));

import ForgotPasswordPage from "../forgot-password/page";

function submit(email = "a@test.com") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.submit(document.querySelector("form")!);
}

describe("ForgotPasswordPage security check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captcha.reset = vi.fn();
  });

  it("spends the token on the request, then fetches a fresh one for 'Try a different email'", async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    render(<ForgotPasswordPage />);
    submit();

    expect(await screen.findByText(/we sent a password reset link/i)).toBeInTheDocument();
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      "a@test.com",
      expect.objectContaining({ captchaToken: "token-1" }),
    );
    expect(captcha.reset).toHaveBeenCalledTimes(1);
  });

  it("still finishes, and still refreshes, when the request throws", async () => {
    mockResetPasswordForEmail.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ForgotPasswordPage />);
    submit();

    expect(await screen.findByText(/we sent a password reset link/i)).toBeInTheDocument();
    expect(captcha.reset).toHaveBeenCalledTimes(1);
  });
});

describe("ForgotPasswordPage from an expired link", () => {
  it("says the link expired", () => {
    window.history.replaceState(null, "", "/auth/forgot-password?expired=true");
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/reset link has expired/i);
    window.history.replaceState(null, "", "/");
  });
});
