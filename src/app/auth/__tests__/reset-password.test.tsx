import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mockVerifyOtp = vi.fn();
const mockExchangeCode = vi.fn();
const mockGetSession = vi.fn();
const mockUpdateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      exchangeCodeForSession: mockExchangeCode,
      getSession: mockGetSession,
      updateUser: mockUpdateUser,
    },
  }),
}));

vi.mock("@/lib/utils/check-breached-password", () => ({
  isPasswordBreached: vi.fn(async () => false),
}));

const mockShow = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ show: mockShow, remove: vi.fn(), ToastElements: null }),
}));

const mockReplace = vi.fn();
vi.mock("next/navigation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/navigation")>();
  return {
    ...mod,
    useRouter: () => ({
      push: vi.fn(),
      refresh: vi.fn(),
      replace: mockReplace,
      back: vi.fn(),
      prefetch: vi.fn(),
    }),
  };
});

import ResetPasswordPage from "../reset-password/page";

const EXPIRED = "/auth/forgot-password?expired=true";
const PASSWORD = "Correct-Horse-Battery-9";

function openAt(url: string) {
  window.history.replaceState({}, "", url);
}

async function submitPassword() {
  const button = await screen.findByRole("button", { name: "Update password" });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: PASSWORD } });
  fireEvent.click(button);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockVerifyOtp.mockResolvedValue({ error: null });
  mockUpdateUser.mockResolvedValue({ error: null });
});

describe("ResetPasswordPage", () => {
  it("spends the email's token only when the password is submitted", async () => {
    openAt("/auth/reset-password?token_hash=abc&type=recovery");
    render(<ResetPasswordPage />);

    await screen.findByRole("button", { name: "Update password" });
    // Loading the page (or reloading it) must not use the token up.
    expect(mockVerifyOtp).not.toHaveBeenCalled();

    await submitPassword();
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: PASSWORD }));
    expect(mockVerifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc" });
    expect(window.location.search).toBe("");
  });

  it("retries a rejected password without re-spending the token", async () => {
    openAt("/auth/reset-password?token_hash=abc&type=recovery");
    mockUpdateUser.mockResolvedValueOnce({
      error: { code: "same_password", message: "same", name: "AuthApiError" },
    });
    render(<ResetPasswordPage />);

    await submitPassword();
    expect(
      await screen.findByText("Your new password must be different from your current one."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(2));
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
  });

  it("sends a used or expired token to request a new link", async () => {
    openAt("/auth/reset-password?token_hash=abc&type=recovery");
    mockVerifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "expired" } });
    render(<ResetPasswordPage />);

    await submitPassword();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(EXPIRED));
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("does not show the form for a link Supabase already rejected", async () => {
    openAt(
      "/auth/reset-password?error=access_denied&error_code=otp_expired#error=access_denied&error_code=otp_expired",
    );
    render(<ResetPasswordPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(EXPIRED));
  });

  it("does not redeem a ?code= link a second time", async () => {
    // The Supabase client redeems the code itself on start-up; by the time
    // getSession() resolves the session is there. Redeeming it again fails
    // and used to bounce a working link to "expired".
    openAt("/auth/reset-password?code=xyz");
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    render(<ResetPasswordPage />);

    await submitPassword();
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalled());
    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("sends a visit with no link and no session to request a new link", async () => {
    openAt("/auth/reset-password");
    render(<ResetPasswordPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(EXPIRED));
  });
});
