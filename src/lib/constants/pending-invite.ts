/**
 * The username whose invite link the visitor followed before they had an
 * account.
 *
 * The gap this bridges is signup itself. Someone opens `/invite/sam_foit`,
 * taps "Create account", and — if email confirmation is on — leaves the tab
 * entirely, comes back through a link in their inbox, and lands in onboarding.
 * A query parameter does not survive that; a cookie does.
 *
 * A cookie rather than localStorage because it is the one store both the
 * client and a server component can read, and because it can be given an
 * expiry: an invite that was never acted on should not still be waiting a year
 * later. Nothing sensitive here — it is a username someone chose to send you.
 */
export const PENDING_INVITE_COOKIE = "motive-pending-invite";

/** Long enough to survive a confirmation email sat unread over a weekend. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Narrow an untrusted value to a username.
 *
 * Same shape as `chk_username_format` in the schema. It runs on the URL
 * segment as well as on the cookie, so a crafted link cannot put arbitrary
 * text on the page or into a query.
 */
export function parseInviteUsername(
  value: string | undefined | null,
): string | null {
  if (!value) return null;
  return /^[a-zA-Z0-9_]{3,30}$/.test(value) ? value.toLowerCase() : null;
}

export function persistPendingInvite(username: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${PENDING_INVITE_COOKIE}=${encodeURIComponent(username)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

/** Read synchronously, for a redirect decision taken during a render. */
export function readPendingInvite(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split("; ")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === PENDING_INVITE_COOKIE) {
      return parseInviteUsername(decodeURIComponent(part.slice(eq + 1)));
    }
  }
  return null;
}

export function clearPendingInvite() {
  if (typeof document === "undefined") return;
  document.cookie = `${PENDING_INVITE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** The invite page for a username. */
export function invitePath(username: string): string {
  return `/invite/${username}`;
}

/**
 * Where to send someone who has just finished authenticating.
 *
 * Every auth screen ends by pushing the user at the dashboard. When an invite
 * is waiting, it ends by pushing them back at the invite instead, which is the
 * one place that knows what to do with one — rather than teaching login,
 * signup, onboarding and complete-profile each to send a friend request.
 */
export function destinationAfterAuth(fallback = "/main/dashboard"): string {
  const username = readPendingInvite();
  return username ? invitePath(username) : fallback;
}
