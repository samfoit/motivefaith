import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readLocalUserId, getAuthStorageKey } from "../local-session";

const SUPABASE_URL = "https://abcdefghijklm.supabase.co";
const KEY = "sb-abcdefghijklm-auth-token";
const USER_ID = "11111111-2222-3333-4444-555555555555";

function base64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A structurally real JWT — header.payload.signature, payload carrying `sub`. */
function jwt(sub: string): string {
  return [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(JSON.stringify({ sub, role: "authenticated", exp: 9999999999 })),
    "not-a-real-signature",
  ].join(".");
}

function clearCookies() {
  for (const part of document.cookie.split("; ")) {
    const name = part.split("=")[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/`;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  clearCookies();
});

afterEach(() => {
  clearCookies();
  vi.unstubAllEnvs();
});

describe("getAuthStorageKey", () => {
  it("derives the cookie name the way supabase-js does", () => {
    expect(getAuthStorageKey()).toBe(KEY);
  });

  it("handles a local Supabase host", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(getAuthStorageKey()).toBe("sb-127-auth-token");
  });

  it("returns null when the env var is missing or unparseable", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(getAuthStorageKey()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    expect(getAuthStorageKey()).toBeNull();
  });
});

describe("readLocalUserId", () => {
  it("reads the id from a plain JSON session cookie", () => {
    setCookie(KEY, JSON.stringify({ access_token: jwt(USER_ID) }));
    expect(readLocalUserId()).toBe(USER_ID);
  });

  it("reads the id from a base64- prefixed cookie", () => {
    const session = JSON.stringify({ access_token: jwt(USER_ID) });
    setCookie(KEY, `base64-${base64Url(session)}`);
    expect(readLocalUserId()).toBe(USER_ID);
  });

  it("reassembles a chunked cookie", () => {
    const session = JSON.stringify({ access_token: jwt(USER_ID) });
    const encoded = `base64-${base64Url(session)}`;
    const mid = Math.floor(encoded.length / 2);
    setCookie(`${KEY}.0`, encoded.slice(0, mid));
    setCookie(`${KEY}.1`, encoded.slice(mid));
    expect(readLocalUserId()).toBe(USER_ID);
  });

  it("prefers the inline user object over decoding the JWT", () => {
    setCookie(
      KEY,
      JSON.stringify({ access_token: jwt("jwt-subject"), user: { id: USER_ID } }),
    );
    expect(readLocalUserId()).toBe(USER_ID);
  });

  it("ignores an unrelated cookie with a similar name", () => {
    setCookie("sb-other-auth-token", JSON.stringify({ access_token: jwt(USER_ID) }));
    expect(readLocalUserId()).toBeNull();
  });

  it("returns null when signed out", () => {
    expect(readLocalUserId()).toBeNull();
  });

  // Each of these is a way the cookie format could drift under us. All of them
  // must fail safe — null means "anonymous", which discards the persisted
  // cache rather than risking showing it to the wrong person.
  it.each([
    ["not json at all", "hello world"],
    ["json without a token", JSON.stringify({ refresh_token: "r" })],
    ["a malformed jwt", JSON.stringify({ access_token: "only.two" })],
    ["a jwt with no sub", JSON.stringify({ access_token: jwt("") })],
    ["undecodable base64", "base64-!!!!not-base64!!!!"],
    ["an empty value", ""],
  ])("fails safe on %s", (_label, value) => {
    setCookie(KEY, value);
    expect(readLocalUserId()).toBeNull();
  });
});
