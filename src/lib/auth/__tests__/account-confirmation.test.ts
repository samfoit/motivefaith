import { describe, it, expect } from "vitest";
import {
  RECENT_SIGN_IN_MS,
  accountConfirmation,
  lastAuthenticatedAt,
  signedInRecently,
  signsInWithPassword,
} from "../account-confirmation";

const NOW = Date.parse("2026-11-10T18:00:00Z");
const seconds = (ms: number) => Math.floor(ms / 1000);

describe("signsInWithPassword", () => {
  it("is true for an account made with an email and password", () => {
    expect(signsInWithPassword({ app_metadata: { provider: "email", providers: ["email"] } })).toBe(true);
    expect(signsInWithPassword({ identities: [{ provider: "email" }] })).toBe(true);
    expect(signsInWithPassword({ app_metadata: { provider: "email" } })).toBe(true);
  });

  it("is true when Google is linked to it as well", () => {
    expect(
      signsInWithPassword({ app_metadata: { provider: "email", providers: ["email", "google"] } }),
    ).toBe(true);
    expect(signsInWithPassword({ identities: [{ provider: "google" }, { provider: "email" }] })).toBe(true);
  });

  it("is false for an account made with Google", () => {
    expect(
      signsInWithPassword({
        app_metadata: { provider: "google", providers: ["google"] },
        identities: [{ provider: "google" }],
      }),
    ).toBe(false);
  });

  it("is false when nothing says how the account signs in", () => {
    expect(signsInWithPassword({})).toBe(false);
    expect(signsInWithPassword({ app_metadata: null, identities: null })).toBe(false);
    expect(signsInWithPassword({ app_metadata: { providers: "email" } })).toBe(false);
  });
});

describe("lastAuthenticatedAt", () => {
  it("is when the session signed in, from the token", () => {
    const at = seconds(NOW - 3 * 60_000);
    expect(lastAuthenticatedAt({ amr: [{ method: "oauth", timestamp: at }] }, {})).toBe(at * 1000);
  });

  it("is the latest, when the session has proved itself more than once", () => {
    const first = seconds(NOW - 50 * 60_000);
    const second = seconds(NOW - 2 * 60_000);
    expect(
      lastAuthenticatedAt(
        { amr: [{ method: "password", timestamp: first }, { method: "totp", timestamp: second }] },
        {},
      ),
    ).toBe(second * 1000);
  });

  it("prefers the session's own sign-in to the account's, which another device may have moved", () => {
    const here = seconds(NOW - 40 * 60_000);
    expect(
      lastAuthenticatedAt(
        { amr: [{ method: "oauth", timestamp: here }] },
        { last_sign_in_at: new Date(NOW - 60_000).toISOString() },
      ),
    ).toBe(here * 1000);
  });

  it("falls back to the account's last sign-in when the token carries none", () => {
    const last = new Date(NOW - 5 * 60_000).toISOString();
    expect(lastAuthenticatedAt(null, { last_sign_in_at: last })).toBe(Date.parse(last));
    expect(lastAuthenticatedAt({ amr: [] }, { last_sign_in_at: last })).toBe(Date.parse(last));
    expect(lastAuthenticatedAt({ amr: ["oauth", null, { method: "oauth" }] }, { last_sign_in_at: last })).toBe(
      Date.parse(last),
    );
  });

  it("is unknown when neither says", () => {
    expect(lastAuthenticatedAt(null, {})).toBeNull();
    expect(lastAuthenticatedAt({ amr: "oauth" }, { last_sign_in_at: "not a date" })).toBeNull();
  });
});

describe("signedInRecently", () => {
  it("holds for ten minutes and no longer", () => {
    expect(signedInRecently(NOW - 60_000, NOW)).toBe(true);
    expect(signedInRecently(NOW - RECENT_SIGN_IN_MS, NOW)).toBe(true);
    expect(signedInRecently(NOW - RECENT_SIGN_IN_MS - 1, NOW)).toBe(false);
  });

  it("is false when the sign-in time is unknown", () => {
    expect(signedInRecently(null, NOW)).toBe(false);
  });

  it("allows for a clock a little behind the one that stamped the token", () => {
    expect(signedInRecently(NOW + 5_000, NOW)).toBe(true);
  });
});

describe("accountConfirmation", () => {
  const google = { app_metadata: { provider: "google", providers: ["google"] } };
  const email = { app_metadata: { provider: "email", providers: ["email"] } };

  it("asks a password account for its password, however recently it signed in", () => {
    expect(
      accountConfirmation(email, { amr: [{ method: "password", timestamp: seconds(NOW - 1000) }] }, NOW),
    ).toBe("password");
  });

  it("takes a Google account's recent sign-in in its place", () => {
    expect(
      accountConfirmation(google, { amr: [{ method: "oauth", timestamp: seconds(NOW - 4 * 60_000) }] }, NOW),
    ).toBe("recent_sign_in");
  });

  it("sends a Google account back to sign in when that was a while ago", () => {
    expect(
      accountConfirmation(google, { amr: [{ method: "oauth", timestamp: seconds(NOW - 3 * 3600_000) }] }, NOW),
    ).toBe("sign_in_again");
    expect(accountConfirmation(google, null, NOW)).toBe("sign_in_again");
  });
});
