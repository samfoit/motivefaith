import { beforeEach, describe, expect, it } from "vitest";
import {
  GOOGLE_CALLBACK_PATH,
  prepareGoogleRedirect,
  readGoogleCallback,
  takeRedirectState,
} from "../google-redirect";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The cookie is scoped to the callback, so it is read there, as in the app.
beforeEach(() => {
  window.history.replaceState({}, "", GOOGLE_CALLBACK_PATH);
  takeRedirectState();
});

describe("Google sign-in by redirect", () => {
  it("sends Google this site's callback, not Supabase's, asking for an ID token", async () => {
    const url = new URL(await prepareGoogleRedirect("client-123"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${window.location.origin}/auth/google/callback`,
    );
    expect(url.searchParams.get("response_type")).toBe("id_token");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    // Asks which account every time, so a second Gmail can be used.
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("keeps the state and the raw nonce for the way back, and sends Google only the nonce's hash", async () => {
    const url = new URL(await prepareGoogleRedirect("client-123"));
    const saved = takeRedirectState();

    expect(saved).not.toBeNull();
    expect(url.searchParams.get("state")).toBe(saved!.state);
    expect(url.searchParams.get("nonce")).toBe(await sha256Hex(saved!.nonce));
    expect(url.toString()).not.toContain(saved!.nonce);
  });

  it("gives the state up once: reading it clears it", async () => {
    await prepareGoogleRedirect("client-123");
    expect(takeRedirectState()).not.toBeNull();
    expect(takeRedirectState()).toBeNull();
  });

  it("starts fresh each time", async () => {
    const first = new URL(await prepareGoogleRedirect("client-123"));
    const second = new URL(await prepareGoogleRedirect("client-123"));
    expect(second.searchParams.get("state")).not.toBe(first.searchParams.get("state"));
    expect(takeRedirectState()!.state).toBe(second.searchParams.get("state"));
  });

  it("ignores a cookie that isn't one it wrote", () => {
    document.cookie = `motive-google-signin=hello.world; path=${GOOGLE_CALLBACK_PATH}`;
    expect(takeRedirectState()).toBeNull();
  });

  it("reads what Google sent back", () => {
    expect(readGoogleCallback("#state=abc&id_token=tok&authuser=0&prompt=consent")).toEqual({
      kind: "token",
      idToken: "tok",
      state: "abc",
    });
    expect(readGoogleCallback("#error=access_denied&state=abc")).toEqual({ kind: "cancelled" });
    expect(readGoogleCallback("#error=invalid_request")).toEqual({ kind: "error" });
    expect(readGoogleCallback("")).toEqual({ kind: "error" });
  });
});
