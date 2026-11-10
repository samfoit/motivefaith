/**
 * Who may call the functions that only this project's own machinery should
 * reach: send-push, check-missed-habits, habit-reminders, weekly-summary and
 * purge-media.
 *
 * They are deployed with `verify_jwt = false` (supabase/config.toml), because
 * the other functions call them with a secret key, which is not a JWT and
 * which the gateway would turn away. So the gateway checks nothing, and
 * whatever arrives here is exactly what the caller typed. Reading a token's
 * `role` claim without checking its signature therefore proves nothing: a
 * token anyone can write by hand says "service_role" as readily as a real
 * one. That is what these functions used to do, along with trusting a
 * `pg_net/` User-Agent, and it let anyone on the internet send a push to any
 * user.
 *
 * A caller is let in only when the key it presents is one of two things:
 *
 * 1. One of this function's own keys, compared whole. That is what the other
 *    functions send, and what the database sends once its vault holds a
 *    secret key.
 * 2. A key the platform itself vouches for. The database's vault may still
 *    hold the project's legacy `service_role` JWT, which is not among this
 *    function's keys and which only the platform can check the signature of.
 *    So it is used, as presented, to call `caller_is_service_role()` (055),
 *    which only the service role can run. A forged or expired token never
 *    gets that far.
 *
 * No imports, so the test suite can load it outside Deno.
 */

/** `Deno.env`, or anything shaped like it. */
export interface Env {
  get(name: string): string | undefined;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A real key is far longer; this only keeps an unset variable from matching. */
const MIN_KEY_LENGTH = 20;

/** How long the platform gets to answer before the caller is turned away. */
const VERIFY_TIMEOUT_MS = 5000;

export function forbidden(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/** Whole-string comparison that takes the same time wherever they differ. */
function sameKey(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

/**
 * The keys this function was started with: the service key, and every named
 * secret key (`SUPABASE_SECRET_KEYS` is a JSON dictionary of them).
 */
export function ownKeys(env: Env): string[] {
  const keys: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.length >= MIN_KEY_LENGTH) keys.push(value);
  };

  add(env.get("SUPABASE_SERVICE_ROLE_KEY"));
  try {
    const named: unknown = JSON.parse(env.get("SUPABASE_SECRET_KEYS") ?? "null");
    if (named && typeof named === "object") Object.values(named).forEach(add);
  } catch {
    // Not JSON: there are no named keys to add.
  }
  return keys;
}

/**
 * What the caller presented. A secret key belongs on `apikey`; the callers
 * this project already has send theirs as a bearer token. Either is read.
 */
export function presentedKeys(req: Request): string[] {
  const keys = new Set<string>();
  const apikey = req.headers.get("apikey")?.trim();
  if (apikey) keys.add(apikey);
  const bearer = req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (bearer) keys.add(bearer);
  return [...keys].filter((key) => key.length >= MIN_KEY_LENGTH);
}

/** Three base64url parts. Says nothing about whether it is genuine. */
function looksLikeJwt(key: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key);
}

/**
 * Ask the platform whether this key is a service-role one, by using it. The
 * API checks the signature before anything runs, and `caller_is_service_role`
 * is granted to the service role alone.
 */
async function vouchedFor(key: string, env: Env, fetchImpl: Fetch): Promise<boolean> {
  const supabaseUrl = env.get("SUPABASE_URL");
  if (!supabaseUrl) return false;
  try {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/caller_is_service_role`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

/** True only for a caller holding one of this project's service keys. */
export async function isInternalCaller(
  req: Request,
  env: Env,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  const presented = presentedKeys(req);
  if (presented.length === 0) return false;

  const own = ownKeys(env);
  if (presented.some((key) => own.some((mine) => sameKey(key, mine)))) return true;

  for (const key of presented) {
    if (looksLikeJwt(key) && (await vouchedFor(key, env, fetchImpl))) return true;
  }
  return false;
}
