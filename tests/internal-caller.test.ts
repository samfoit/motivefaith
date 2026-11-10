import { describe, expect, it, vi } from "vitest";
import {
  isInternalCaller,
  ownKeys,
  presentedKeys,
} from "../supabase/functions/_shared/internal-caller";

/**
 * Who the functions let in. They run with the gateway's JWT check off, so
 * this is the only check there is: a caller gets in on one of the function's
 * own keys, or on a key the platform itself confirms is a service-role one.
 * Reading a token's `role` claim proves nothing, and used to be enough.
 */

const OWN_KEY = "sb_secret_abcdefghijklmnopqrstuvwxyz012345";
const NAMED_KEY = "sb_secret_zyxwvutsrqponmlkjihgfedcba543210";
const SUPABASE_URL = "https://project.example";

function env(values: Record<string, string | undefined>) {
  return { get: (name: string) => values[name] };
}

const ENV = env({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: OWN_KEY,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: OWN_KEY, cron: NAMED_KEY }),
});

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Shaped like a JWT, signed by nobody. */
function handWritten(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.not-a-real-signature`;
}

function request(headers: Record<string, string>): Request {
  return new Request("https://project.example/functions/v1/send-push", {
    method: "POST",
    headers,
    body: "{}",
  });
}

/** The platform's answer to "is this key the service role's?". */
function platform(status: number, body: unknown = null) {
  return vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

describe("the keys a function holds", () => {
  it("are its service key and every named secret key", () => {
    expect(ownKeys(ENV).sort()).toEqual([OWN_KEY, NAMED_KEY, OWN_KEY].sort());
  });

  it("are none at all when nothing is set, rather than an empty string that matches", () => {
    expect(ownKeys(env({}))).toEqual([]);
    expect(ownKeys(env({ SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_SECRET_KEYS: "not json" }))).toEqual([]);
  });
});

describe("the key a caller presents", () => {
  it("is read from apikey and from a bearer token", () => {
    expect(presentedKeys(request({ apikey: OWN_KEY }))).toEqual([OWN_KEY]);
    expect(presentedKeys(request({ Authorization: `Bearer ${OWN_KEY}` }))).toEqual([OWN_KEY]);
    expect(presentedKeys(request({ Authorization: `bearer ${OWN_KEY}` }))).toEqual([OWN_KEY]);
    expect(
      presentedKeys(request({ apikey: NAMED_KEY, Authorization: `Bearer ${OWN_KEY}` })).sort(),
    ).toEqual([NAMED_KEY, OWN_KEY].sort());
  });

  it("is nothing when there is no key, or only a scheme", () => {
    expect(presentedKeys(request({}))).toEqual([]);
    expect(presentedKeys(request({ Authorization: "Bearer " }))).toEqual([]);
    expect(presentedKeys(request({ Authorization: "Basic dXNlcjpwYXNz" }))).toEqual([]);
  });
});

describe("who a function lets in", () => {
  it("lets in a caller holding its own key, without asking anyone", async () => {
    const ask = platform(500);
    expect(await isInternalCaller(request({ Authorization: `Bearer ${OWN_KEY}` }), ENV, ask)).toBe(true);
    expect(await isInternalCaller(request({ apikey: NAMED_KEY }), ENV, ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("turns away a hand-written token that says it is the service role", async () => {
    // What got in before: the claim was read, the signature never checked.
    const forged = handWritten({ role: "service_role", iss: "supabase" });
    const ask = platform(401, { message: "JWSError JWSInvalidSignature" });

    expect(await isInternalCaller(request({ Authorization: `Bearer ${forged}` }), ENV, ask)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("turns away a request with no key, whatever it calls itself", async () => {
    const ask = platform(200, true);
    expect(await isInternalCaller(request({ "User-Agent": "pg_net/0.20.0" }), ENV, ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it("lets in the vault's legacy key once the platform confirms it", async () => {
    const legacy = handWritten({ role: "service_role", iss: "supabase", ref: "project" });
    const ask = platform(200, true);

    expect(await isInternalCaller(request({ Authorization: `Bearer ${legacy}` }), ENV, ask)).toBe(true);

    // It is confirmed by being used: the API checks its signature, and the
    // question is one only the service role may ask.
    const [url, init] = ask.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/rest/v1/rpc/caller_is_service_role`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ apikey: legacy, Authorization: `Bearer ${legacy}` });
  });

  it("turns away a genuine token that is not the service role's", async () => {
    // A signed-in user's own token: the API accepts it, the question refuses it.
    const userToken = handWritten({ role: "authenticated", sub: "a1111111-1111-1111-1111-111111111111" });
    expect(
      await isInternalCaller(
        request({ Authorization: `Bearer ${userToken}` }),
        ENV,
        platform(403, { code: "42501", message: "permission denied for function caller_is_service_role" }),
      ),
    ).toBe(false);
    expect(
      await isInternalCaller(request({ Authorization: `Bearer ${userToken}` }), ENV, platform(200, false)),
    ).toBe(false);
  });

  it("turns the caller away when the platform cannot be asked", async () => {
    const legacy = handWritten({ role: "service_role" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    expect(await isInternalCaller(request({ Authorization: `Bearer ${legacy}` }), ENV, down)).toBe(false);
    expect(
      await isInternalCaller(
        request({ Authorization: `Bearer ${legacy}` }),
        env({ SUPABASE_SERVICE_ROLE_KEY: OWN_KEY }),
        platform(200, true),
      ),
    ).toBe(false);
  });

  it("never asks about a key that is neither its own nor a token", async () => {
    const ask = platform(200, true);
    expect(
      await isInternalCaller(request({ apikey: "sb_secret_someone_elses_key_0123456789" }), ENV, ask),
    ).toBe(false);
    expect(await isInternalCaller(request({ apikey: `${OWN_KEY}x` }), ENV, ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it("matches no key when the function was started without one", async () => {
    const ask = platform(401);
    const bare = env({ SUPABASE_URL });
    expect(await isInternalCaller(request({ Authorization: "Bearer " }), bare, ask)).toBe(false);
    expect(await isInternalCaller(request({ apikey: "" }), bare, ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
});
