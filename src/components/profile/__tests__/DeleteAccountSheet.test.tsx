import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const USER = "a1111111-1111-4111-8111-111111111111";

/** Who the browser's session says is signed in. */
const auth = vi.hoisted(() => ({ userId: "a1111111-1111-4111-8111-111111111111" }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: vi.fn(),
      getUser: async () => ({ data: { user: { id: auth.userId } } }),
    },
  }),
}));

vi.mock("@/components/ui/Turnstile", () => ({
  Turnstile: () => <div data-testid="turnstile" />,
}));

// Google's button, reduced to the one thing the dialog needs of it: a way to
// say "signed in".
vi.mock("@/app/auth/GoogleSignIn", () => ({
  GoogleSignIn: ({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) => (
    <button type="button" onClick={() => void onSignedIn()}>
      Continue with Google
    </button>
  ),
  destinationAfterGoogle: async () => "/main/dashboard",
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

import { DeleteAccountSheet } from "../DeleteAccountSheet";

type Confirmation = "password" | "recent_sign_in" | "sign_in_again";

/**
 * `/api/account`: GET answers how this account confirms it is them — each
 * answer in `confirmations` in turn, the last one repeating — and DELETE is
 * the caller's to script.
 */
function stubAccountApi(
  confirmations: (Confirmation | "fails")[],
  onDelete: (body: Record<string, unknown>) => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
) {
  let asked = 0;
  const deletes: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      const answer = confirmations[Math.min(asked++, confirmations.length - 1)];
      return answer === "fails"
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ confirmWith: answer }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    deletes.push(body);
    return onDelete(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { deletes, timesAsked: () => asked };
}

function renderSheet(onOpenChange: (open: boolean) => void = () => {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DeleteAccountSheet open onOpenChange={onOpenChange} userId={USER} />
    </QueryClientProvider>,
  );
}

function typePhrase() {
  fireEvent.change(screen.getByPlaceholderText(/delete my account/), {
    target: { value: "delete my account" },
  });
}

const deleteButton = () => screen.getByRole("button", { name: "Delete my account" });

beforeEach(() => {
  auth.userId = USER;
  captcha.reset = vi.fn();
  vi.stubGlobal("location", { ...window.location, replace: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DeleteAccountSheet for an account with a password", () => {
  async function attempt() {
    renderSheet();
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "mistyped" } });
    typePhrase();
    fireEvent.click(deleteButton());
  }

  it("names its fields for screen readers", async () => {
    stubAccountApi(["password"]);
    renderSheet();

    expect(await screen.findByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("To confirm, type the phrase below")).toHaveAccessibleDescription(
      "delete my account",
    );
  });

  it("needs the password and the phrase before it can be sent", async () => {
    stubAccountApi(["password"]);
    renderSheet();

    const password = await screen.findByLabelText("Password");
    expect(deleteButton()).toBeDisabled();
    typePhrase();
    expect(deleteButton()).toBeDisabled();
    fireEvent.change(password, { target: { value: "hunter2hunter2" } });
    expect(deleteButton()).toBeEnabled();
  });

  it("sends the password with the security token", async () => {
    const api = stubAccountApi(["password"]);
    await attempt();

    await waitFor(() => expect(api.deletes).toHaveLength(1));
    expect(api.deletes[0]).toEqual({ password: "mistyped", captchaToken: "token-1" });
  });

  it("fetches a fresh token after a refused attempt, so the retry isn't turned away", async () => {
    stubAccountApi(["password"], () =>
      new Response(JSON.stringify({ error: "Incorrect password" }), { status: 401 }),
    );
    await attempt();

    expect(await screen.findByText("Incorrect password")).toBeInTheDocument();
    expect(captcha.reset).toHaveBeenCalledTimes(1);
  });

  it("fetches a fresh token after a network failure too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubAccountApi(["password"], () => Promise.reject(new TypeError("Failed to fetch")));
    await attempt();

    expect(await screen.findByText("Network error. Please try again.")).toBeInTheDocument();
    await waitFor(() => expect(captcha.reset).toHaveBeenCalledTimes(1));
  });
});

describe("DeleteAccountSheet for an account that signs in with Google", () => {
  it("asks for no password when it signed in a moment ago", async () => {
    const api = stubAccountApi(["recent_sign_in"]);
    renderSheet();

    expect(await screen.findByText(/signed in with Google a few minutes ago/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    // No password check, so no security token to spend on one.
    expect(screen.queryByTestId("turnstile")).not.toBeInTheDocument();

    expect(deleteButton()).toBeDisabled();
    typePhrase();
    expect(deleteButton()).toBeEnabled();

    fireEvent.click(deleteButton());
    await waitFor(() => expect(api.deletes).toEqual([{}]));
    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith("/auth/login?deleted=1"));
  });

  it("has it sign in again when that was a while ago, and can't be sent until it has", async () => {
    const api = stubAccountApi(["sign_in_again", "recent_sign_in"]);
    renderSheet();

    expect(await screen.findByText(/Sign in with Google again to confirm it's you/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    typePhrase();
    expect(deleteButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText(/signed in with Google a few minutes ago/)).toBeInTheDocument();
    expect(deleteButton()).toBeEnabled();
    expect(api.timesAsked()).toBe(2);
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("leaves the profile when Google signs in a different account", async () => {
    stubAccountApi(["sign_in_again", "recent_sign_in"]);
    renderSheet();
    typePhrase();

    // They picked another Gmail in Google's chooser.
    auth.userId = "c3333333-3333-4333-8333-333333333333";
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith("/main/dashboard"));
    // Still not something that can be sent: this was the other account's page.
    expect(deleteButton()).toBeDisabled();
  });

  it("goes back to signing in when the ten minutes ran out with the dialog open", async () => {
    stubAccountApi(["recent_sign_in"], () =>
      new Response(
        JSON.stringify({ error: "Sign in again to delete your account", code: "reauth_required" }),
        { status: 401 },
      ),
    );
    renderSheet();
    await screen.findByText(/signed in with Google a few minutes ago/);
    typePhrase();
    fireEvent.click(deleteButton());

    expect(await screen.findByText(/more than 10 minutes ago/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(deleteButton()).toBeDisabled();
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});

describe("DeleteAccountSheet before it knows how the account signs in", () => {
  it("shows neither a password field nor a way to send while it checks", async () => {
    let answer: (res: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    renderSheet();

    expect(screen.getByRole("status")).toHaveTextContent("Checking how you sign in…");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    typePhrase();
    expect(deleteButton()).toBeDisabled();

    answer(new Response(JSON.stringify({ confirmWith: "password" }), { status: 200 }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("says so when it couldn't find out, and can't be sent", async () => {
    stubAccountApi(["fails"]);
    renderSheet();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check how to confirm it's you");
    typePhrase();
    expect(deleteButton()).toBeDisabled();
  });

  it("treats an answer it doesn't know as not knowing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ confirmWith: "nothing_needed" }), { status: 200 })),
    );
    renderSheet();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    typePhrase();
    expect(deleteButton()).toBeDisabled();
  });

  it("starts over from checking after Cancel, rather than from the last answer", async () => {
    stubAccountApi(["recent_sign_in"]);
    const onOpenChange = vi.fn();
    renderSheet(onOpenChange);
    await screen.findByText(/signed in with Google a few minutes ago/);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("status")).toHaveTextContent("Checking how you sign in…");
  });
});
