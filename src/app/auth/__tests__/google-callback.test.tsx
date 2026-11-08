import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSignInWithIdToken = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithIdToken: mockSignInWithIdToken } }),
}));

const mockDestination = vi.fn();
vi.mock("../GoogleSignIn", () => ({
  destinationAfterGoogle: () => mockDestination(),
}));

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/navigation")>();
  return {
    ...mod,
    useRouter: () => ({
      push: vi.fn(),
      replace: mockReplace,
      refresh: mockRefresh,
      back: vi.fn(),
      prefetch: vi.fn(),
    }),
  };
});

const STATE = "0123456789abcdef0123456789abcdef";
const NONCE = "f".repeat(64);
const COOKIE_PATH = "path=/auth/google/callback";

/**
 * Comes back from Google: the URL as Google sends it, with the cookie this
 * browser left with, and the page loaded fresh, as a full navigation does.
 */
async function arrive(fragment: string, { cookie = `${STATE}.${NONCE}` } = {}) {
  window.history.replaceState({}, "", `/auth/google/callback${fragment}`);
  document.cookie = cookie
    ? `motive-google-signin=${cookie}; ${COOKIE_PATH}`
    : `motive-google-signin=; max-age=0; ${COOKIE_PATH}`;
  vi.resetModules();
  const { default: GoogleCallbackPage } = await import("../google/callback/page");
  return GoogleCallbackPage;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSignInWithIdToken.mockResolvedValue({ error: null });
  mockDestination.mockResolvedValue("/main/dashboard");
});

describe("Google sign-in callback", () => {
  it("takes the token out of the address as it loads", async () => {
    await arrive(`#state=${STATE}&id_token=tok&authuser=0`);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/auth/google/callback");
  });

  it("signs in with the token and the raw nonce, then goes where the button would", async () => {
    mockDestination.mockResolvedValue("/auth/complete-profile");
    const Page = await arrive(`#state=${STATE}&id_token=tok`);
    render(<Page />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/auth/complete-profile"));
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "tok",
      nonce: NONCE,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Finishing with Google");
  });

  it("refuses a token it didn't ask for", async () => {
    const Page = await arrive(`#state=${"9".repeat(32)}&id_token=tok`);
    render(<Page />);

    expect(await screen.findByText("Google sign-in didn't finish")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("refuses a token when this browser has no sign-in under way", async () => {
    const Page = await arrive(`#state=${STATE}&id_token=tok`, { cookie: "" });
    render(<Page />);

    expect(await screen.findByText("Google sign-in didn't finish")).toBeInTheDocument();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("says so when Supabase turns the token down", async () => {
    mockSignInWithIdToken.mockResolvedValue({ error: { message: "Nonces mismatch" } });
    const Page = await arrive(`#state=${STATE}&id_token=tok`);
    render(<Page />);

    expect(await screen.findByText("Google sign-in didn't finish")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("goes quietly back to sign in when Google was backed out of", async () => {
    const Page = await arrive(`#error=access_denied&state=${STATE}`);
    render(<Page />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/auth/login"));
    expect(screen.queryByText("Google sign-in didn't finish")).not.toBeInTheDocument();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("spends the token once, however many times the page mounts", async () => {
    const Page = await arrive(`#state=${STATE}&id_token=tok`);
    const { unmount } = render(<Page />);
    unmount();
    render(<Page />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/main/dashboard"));
    expect(mockSignInWithIdToken).toHaveBeenCalledTimes(1);
  });
});
