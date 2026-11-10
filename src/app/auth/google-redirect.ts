/**
 * Google sign-in by redirect, coming back to this site.
 *
 * Google's own button (GoogleSignIn) signs in through a popup, which the
 * installed app can't use. Its fallback used to be Supabase's redirect flow,
 * whose callback is on Supabase's domain, so Google's account chooser said
 * "to continue to <project>.supabase.co". This one sends Google the site's own
 * callback, so Google names this site (and, once its branding is verified,
 * MotiveFaith), and it gets the ID token back to exchange with Supabase the
 * same way the button does.
 *
 * It asks Google for an ID token alone (OpenID Connect's implicit flow), so no
 * client secret is needed: Supabase checks the token against the client ID
 * and the nonce, whose hash Google signs into the token and whose raw value
 * only this browser holds. The state, kept beside the nonce, ties the answer
 * to a sign-in this browser started. The token comes back in the URL's
 * fragment, which is never sent to a server, and the callback page takes it
 * out of the address before anything else runs.
 *
 * Google only sends users back to a URI listed on the OAuth client, so
 * `<origin>/auth/google/callback` must be one of its Authorized redirect URIs
 * for each origin the app is served from.
 */

export const GOOGLE_CALLBACK_PATH = "/auth/google/callback";

/**
 * The state and raw nonce, between leaving for Google and coming back. A
 * cookie, as Supabase's own flow keeps its PKCE verifier: sessionStorage
 * belongs to one tab, and the trip through Google can come back in another.
 * Scoped to the callback and short-lived, since it's only needed there.
 */
const STATE_COOKIE = "motive-google-signin";
const STATE_MAX_AGE_SECONDS = 10 * 60;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A random nonce and its SHA-256. Google puts the hash in the ID token and
 * Supabase checks the raw value against it, so a token lifted from elsewhere
 * cannot be replayed here.
 */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return { raw, hashed: hex(new Uint8Array(digest)) };
}

export function googleAuthUrl({
  clientId,
  redirectUri,
  state,
  hashedNonce,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  hashedNonce: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: hashedNonce,
    state,
    // Ask which account every time. Left to itself, Google goes straight back
    // with whichever account the browser last used here, so in the installed
    // app there was no way to sign in with a different Gmail.
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function cookieAttributes(maxAge: number): string {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  return `path=${GOOGLE_CALLBACK_PATH}; max-age=${maxAge}; samesite=lax${secure}`;
}

/**
 * Keeps a new state and nonce for the way back, and returns where to send the
 * browser to sign in.
 */
export async function prepareGoogleRedirect(clientId: string): Promise<string> {
  const state = hex(crypto.getRandomValues(new Uint8Array(16)));
  const nonce = await makeNonce();
  document.cookie = `${STATE_COOKIE}=${state}.${nonce.raw}; ${cookieAttributes(STATE_MAX_AGE_SECONDS)}`;
  return googleAuthUrl({
    clientId,
    redirectUri: `${window.location.origin}${GOOGLE_CALLBACK_PATH}`,
    state,
    hashedNonce: nonce.hashed,
  });
}

/** Off to Google, to come back to the callback page. */
export async function startGoogleRedirect(clientId: string): Promise<void> {
  window.location.assign(await prepareGoogleRedirect(clientId));
}

/** The state and nonce this browser left with, once: reading clears them. */
export function takeRedirectState(): { state: string; nonce: string } | null {
  let value: string | null = null;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(`${STATE_COOKIE}=`)) value = part.slice(STATE_COOKIE.length + 1);
  }
  document.cookie = `${STATE_COOKIE}=; ${cookieAttributes(0)}`;

  const match = value?.match(/^([0-9a-f]{32})\.([0-9a-f]{64})$/);
  return match ? { state: match[1], nonce: match[2] } : null;
}

export type GoogleCallback =
  | { kind: "token"; idToken: string; state: string | null }
  /** Backed out at Google: not a failure to report. */
  | { kind: "cancelled" }
  | { kind: "error" };

/** What Google sent back, from the callback URL's fragment. */
export function readGoogleCallback(fragment: string): GoogleCallback {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const error = params.get("error");
  if (error) return error === "access_denied" ? { kind: "cancelled" } : { kind: "error" };
  const idToken = params.get("id_token");
  return idToken ? { kind: "token", idToken, state: params.get("state") } : { kind: "error" };
}
