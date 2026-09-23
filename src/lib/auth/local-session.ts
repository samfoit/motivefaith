/**
 * Synchronous, network-free read of the signed-in user's id from the Supabase
 * auth cookie.
 *
 * WHY THIS EXISTS. Offline there is no server, so `AuthGate` never runs and
 * `getSession()` cannot be awaited before the first paint. Something has to
 * name the user synchronously so the persisted React Query cache can be
 * partitioned per user — otherwise the next person to open the app on a shared
 * device restores the previous person's habits out of IndexedDB.
 *
 * WHAT IT IS NOT. This is an *identity hint for cache partitioning only*. The
 * JWT is read, never verified: anyone can write a cookie. Every real
 * authorization decision stays on the server, behind RLS. Treat a value from
 * here as "which cache bucket", never as "who this person is allowed to be".
 *
 * This reads the cookie rather than local storage because `@supabase/ssr`
 * stores the session in cookies, and its `DEFAULT_COOKIE_OPTIONS` sets
 * `httpOnly: false` — so it is readable from script by design. (`proxy.ts`
 * writes `httpOnly: options?.httpOnly ?? true`, but Supabase always supplies
 * an explicit `false`, so the fallback never applies.)
 */

const BASE64_PREFIX = "base64-";

/**
 * The cookie name Supabase stores the session under.
 *
 * Mirrors supabase-js's own derivation:
 *   `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
 */
export function getAuthStorageKey(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

/** Decode base64url (the JWT/Supabase variant) into a UTF-8 string. */
function decodeBase64Url(value: string): string | null {
  try {
    const padded = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Reassemble the cookie value, which `@supabase/ssr` splits across
 * `<key>.0`, `<key>.1`, … once it exceeds MAX_CHUNK_SIZE (3180 bytes) — a
 * session with a large JWT is routinely chunked, so the unchunked path alone
 * is not enough.
 */
function readRawCookie(key: string): string | null {
  if (typeof document === "undefined") return null;

  const jar = new Map<string, string>();
  for (const part of document.cookie.split("; ")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    try {
      jar.set(name, decodeURIComponent(value));
    } catch {
      jar.set(name, value); // malformed percent-encoding — take it verbatim
    }
  }

  const whole = jar.get(key);
  if (whole) return whole;

  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const chunk = jar.get(`${key}.${i}`);
    if (chunk === undefined) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join("") : null;
}

/** Pull `sub` out of a JWT without verifying it. */
function subjectFromJwt(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = decodeBase64Url(parts[1]);
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && "sub" in parsed) {
      const sub = (parsed as { sub: unknown }).sub;
      return typeof sub === "string" && sub ? sub : null;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * The current user's id, or `null` if there is no readable session.
 *
 * Every failure mode returns `null`, which fails *safe*: callers treat it as
 * "anonymous", the persisted cache is discarded rather than shared, and the
 * server still decides what the user may actually see.
 */
export function readLocalUserId(): string | null {
  const key = getAuthStorageKey();
  if (!key) return null;

  const raw = readRawCookie(key);
  if (!raw) return null;

  const json = raw.startsWith(BASE64_PREFIX)
    ? decodeBase64Url(raw.slice(BASE64_PREFIX.length))
    : raw;
  if (!json) return null;

  let session: unknown;
  try {
    session = JSON.parse(json);
  } catch {
    return null;
  }
  if (!session || typeof session !== "object") return null;

  // Newer sessions carry the user object inline; older ones only the token.
  const user = (session as { user?: { id?: unknown } }).user;
  if (user && typeof user.id === "string" && user.id) return user.id;

  const accessToken = (session as { access_token?: unknown }).access_token;
  if (typeof accessToken === "string" && accessToken) {
    return subjectFromJwt(accessToken);
  }

  return null;
}
