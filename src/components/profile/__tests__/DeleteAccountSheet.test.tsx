import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
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

import { DeleteAccountSheet } from "../DeleteAccountSheet";

function renderSheet() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DeleteAccountSheet open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(document.querySelector('input[type="password"]')!, {
    target: { value: "mistyped" },
  });
  fireEvent.change(screen.getByPlaceholderText(/delete my account/), {
    target: { value: "delete my account" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
}

describe("DeleteAccountSheet security check", () => {
  beforeEach(() => {
    captcha.reset = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a fresh token after a refused attempt, so the retry isn't turned away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Incorrect password" }), { status: 401 })),
    );
    renderSheet();

    expect(await screen.findByText("Incorrect password")).toBeInTheDocument();
    expect(captcha.reset).toHaveBeenCalledTimes(1);
  });

  it("fetches a fresh token after a network failure too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    renderSheet();

    expect(await screen.findByText("Network error. Please try again.")).toBeInTheDocument();
    await waitFor(() => expect(captcha.reset).toHaveBeenCalledTimes(1));
  });
});

describe("DeleteAccountSheet fields", () => {
  it("names its fields for screen readers", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DeleteAccountSheet open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("To confirm, type the phrase below")).toHaveAccessibleDescription(
      "delete my account",
    );
  });
});
