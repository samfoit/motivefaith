/**
 * How someone proves it is them before their account is deleted.
 *
 * An account made with an email and password types the password again. An
 * account that signs in with Google has no password to type — asking for one
 * left those accounts with no way to delete themselves — so what it shows
 * instead is that it signed in a moment ago: the same proof, given through
 * the only door that account has. Past that window it signs in again first.
 *
 * `/api/account` decides with these; the dialog only asks it which applies.
 */

/** How long after signing in an account with no password may be deleted. */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

export type AccountConfirmation =
  /** Type the password. */
  | "password"
  /** No password, and signed in within the window: nothing more to show. */
  | "recent_sign_in"
  /** No password, and signed in too long ago: sign in again first. */
  | "sign_in_again";

interface AccountLike {
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
  identities?: { provider?: string }[] | null;
  last_sign_in_at?: string | null;
}

/**
 * Whether the account has a password to check: it was made with an email and
 * password, which Supabase records as an `email` identity. `app_metadata` is
 * the server's to write, not the user's.
 *
 * An account made with Google that later set a password through "forgot
 * password" has no `email` identity, and confirms by signing in like any
 * other Google account.
 */
export function signsInWithPassword(user: AccountLike): boolean {
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers) && providers.includes("email")) return true;
  if (user.identities?.some((identity) => identity.provider === "email")) return true;
  return user.app_metadata?.provider === "email";
}

/**
 * When this session last proved who it is, in milliseconds.
 *
 * The access token's `amr` claim lists how the session authenticated and
 * when; refreshing the token carries it over unchanged, so it is the moment
 * of the sign-in, not of the last refresh. Without it, the account's last
 * sign-in on any device.
 */
export function lastAuthenticatedAt(
  claims: { amr?: unknown } | null | undefined,
  user: AccountLike,
): number | null {
  const stamps: number[] = [];
  if (Array.isArray(claims?.amr)) {
    for (const entry of claims.amr) {
      const timestamp =
        entry !== null && typeof entry === "object"
          ? (entry as { timestamp?: unknown }).timestamp
          : undefined;
      if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        stamps.push(timestamp * 1000);
      }
    }
  }
  if (stamps.length > 0) return Math.max(...stamps);

  const lastSignIn = Date.parse(user.last_sign_in_at ?? "");
  return Number.isFinite(lastSignIn) ? lastSignIn : null;
}

export function signedInRecently(at: number | null, now: number = Date.now()): boolean {
  return at !== null && now - at <= RECENT_SIGN_IN_MS;
}

/** Which proof this account, in this session, has to give. */
export function accountConfirmation(
  user: AccountLike,
  claims: { amr?: unknown } | null | undefined,
  now: number = Date.now(),
): AccountConfirmation {
  if (signsInWithPassword(user)) return "password";
  return signedInRecently(lastAuthenticatedAt(claims, user), now) ? "recent_sign_in" : "sign_in_again";
}
