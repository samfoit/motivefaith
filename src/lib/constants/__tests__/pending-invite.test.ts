import { describe, it, expect, beforeEach } from "vitest";
import {
  PENDING_INVITE_COOKIE,
  parseInviteUsername,
  persistPendingInvite,
  readPendingInvite,
  clearPendingInvite,
  destinationAfterAuth,
  invitePath,
} from "../pending-invite";

function wipeCookies() {
  for (const part of document.cookie.split("; ")) {
    const name = part.split("=")[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

beforeEach(wipeCookies);

describe("parseInviteUsername", () => {
  it("accepts the same shape the schema does", () => {
    expect(parseInviteUsername("sam_foit")).toBe("sam_foit");
    expect(parseInviteUsername("abc")).toBe("abc");
    expect(parseInviteUsername("a".repeat(30))).toBe("a".repeat(30));
  });

  it("lowercases, because usernames are stored lowercase", () => {
    expect(parseInviteUsername("SamFoit")).toBe("samfoit");
  });

  it("rejects anything that is not a username", () => {
    // The URL segment reaches the page as untrusted text and ends up rendered
    // and sent to a query, so these must not survive.
    expect(parseInviteUsername("ab")).toBeNull();
    expect(parseInviteUsername("a".repeat(31))).toBeNull();
    expect(parseInviteUsername("sam foit")).toBeNull();
    expect(parseInviteUsername("../../admin")).toBeNull();
    expect(parseInviteUsername("<script>")).toBeNull();
    expect(parseInviteUsername("sam%")).toBeNull();
    expect(parseInviteUsername("")).toBeNull();
    expect(parseInviteUsername(undefined)).toBeNull();
  });
});

describe("the pending invite cookie", () => {
  it("round-trips a username", () => {
    persistPendingInvite("sam_foit");
    expect(document.cookie).toContain(PENDING_INVITE_COOKIE);
    expect(readPendingInvite()).toBe("sam_foit");
  });

  it("clears", () => {
    persistPendingInvite("sam_foit");
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
  });

  it("refuses a value that was tampered with", () => {
    document.cookie = `${PENDING_INVITE_COOKIE}=${encodeURIComponent("/evil")}; path=/`;
    expect(readPendingInvite()).toBeNull();
  });

  it("is not confused by another cookie whose name contains it", () => {
    document.cookie = `x-${PENDING_INVITE_COOKIE}=nope; path=/`;
    persistPendingInvite("sam_foit");
    expect(readPendingInvite()).toBe("sam_foit");
  });
});

describe("destinationAfterAuth", () => {
  it("sends people to the dashboard when no invite is waiting", () => {
    expect(destinationAfterAuth()).toBe("/main/dashboard");
  });

  it("sends people back to the invite that brought them", () => {
    persistPendingInvite("sam_foit");
    expect(destinationAfterAuth()).toBe(invitePath("sam_foit"));
  });

  it("honours a caller's own fallback", () => {
    expect(destinationAfterAuth("/main/habits")).toBe("/main/habits");
  });
});
