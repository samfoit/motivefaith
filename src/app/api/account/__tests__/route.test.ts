import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/utils/csrf", () => ({ verifyCsrf: vi.fn(() => null) }));

interface SessionUser {
  id: string;
  email?: string;
  app_metadata?: { provider?: string; providers?: string[] };
  last_sign_in_at?: string;
}

/** Who is asking, as the session cookie says. */
const session = vi.hoisted(() => ({
  user: null as SessionUser | null,
  /** The access token's claims; `amr` says how and when the session signed in. */
  claims: null as { amr?: { method: string; timestamp: number }[] } | null,
  /** RPCs the route ran as the user, in order. */
  rpcCalls: [] as { name: string; args: unknown }[],
  rpcError: null as { message: string; code: string } | null,
}));

vi.mock("@/lib/utils/api-helpers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/utils/api-helpers")>();
  return {
    ...mod,
    requireAuthUser: vi.fn(async () =>
      session.user
        ? {
            ok: true as const,
            user: session.user,
            supabase: {
              auth: {
                getClaims: async () => ({
                  data: session.claims ? { claims: session.claims } : null,
                  error: null,
                }),
              },
            },
          }
        : { ok: false as const, response: mod.jsonResponse({ error: "Unauthorized" }, { status: 401 }) },
    ),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    rpc: async (name: string, args: unknown) => {
      session.rpcCalls.push({ name, args });
      return { data: null, error: session.rpcError };
    },
  })),
}));

/** Supabase as the two clients the route makes for itself see it. */
const supabase = vi.hoisted(() => ({
  password: "correct horse battery staple",
  signIns: [] as { email: string; password: string; captchaToken?: string }[],
  /** Stored files, as "bucket/path". */
  stored: new Set<string>(),
  storageError: null as { message: string } | null,
  removeCalls: [] as string[][],
}));

const SERVICE_KEY = "service-key";

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string) => {
    if (key !== SERVICE_KEY) {
      // The isolated client the password is checked on.
      return {
        auth: {
          signInWithPassword: async (creds: {
            email: string;
            password: string;
            options?: { captchaToken?: string };
          }) => {
            supabase.signIns.push({
              email: creds.email,
              password: creds.password,
              captchaToken: creds.options?.captchaToken,
            });
            return creds.password === supabase.password
              ? { data: {}, error: null }
              : { data: {}, error: { message: "Invalid login credentials" } };
          },
        },
      };
    }
    // The service-role client, used for storage. It lists and removes the
    // way Storage does: a folder comes back with a null id, and `remove`
    // takes exact paths.
    return {
      storage: {
        from: (bucket: string) => ({
          list: async (folder: string, { limit, offset }: { limit: number; offset: number }) => {
            if (supabase.storageError) return { data: null, error: supabase.storageError };
            const names = new Map<string, string | null>();
            for (const file of supabase.stored) {
              const prefix = `${bucket}/${folder}/`;
              if (!file.startsWith(prefix)) continue;
              const rest = file.slice(prefix.length);
              const slash = rest.indexOf("/");
              names.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? "an-id" : null);
            }
            const entries = [...names.entries()]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .slice(offset, offset + limit)
              .map(([name, id]) => ({ name, id }));
            return { data: entries, error: null };
          },
          remove: async (paths: string[]) => {
            if (supabase.storageError) return { data: null, error: supabase.storageError };
            supabase.removeCalls.push(paths);
            for (const path of paths) supabase.stored.delete(`${bucket}/${path}`);
            return { data: [], error: null };
          },
        }),
      },
    };
  },
}));

const { DELETE, GET } = await import("../route");

const USER = "a1111111-1111-4111-8111-111111111111";
const OTHER = "c3333333-3333-4333-8333-333333333333";
const HABIT = "b2222222-2222-4222-8222-222222222222";

function deleteRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Seconds since the epoch, some minutes back: what an `amr` entry carries. */
function minutesAgo(minutes: number): number {
  return Math.floor((Date.now() - minutes * 60_000) / 1000);
}

/** An account made with an email and password, signed in a while ago. */
function passwordAccount(): SessionUser {
  return {
    id: USER,
    email: "alice@test.com",
    app_metadata: { provider: "email", providers: ["email"] },
  };
}

/** An account made with Google: no password anywhere. */
function googleAccount(): SessionUser {
  return {
    id: USER,
    email: "alice@gmail.com",
    app_metadata: { provider: "google", providers: ["google"] },
  };
}

function signedIn(method: string, minutes: number) {
  return { amr: [{ method, timestamp: minutesAgo(minutes) }] };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  session.user = passwordAccount();
  session.claims = signedIn("password", 90);
  session.rpcCalls = [];
  session.rpcError = null;
  supabase.signIns = [];
  supabase.storageError = null;
  supabase.removeCalls = [];
  supabase.stored = new Set([
    `avatars/${USER}/avatar.webp`,
    `completions/${USER}/${HABIT}/1700000000000.webp`,
    `completions/${USER}/${HABIT}/1700000000001.mp4`,
    `completions/${USER}/capture/voice.webm`,
    `completions/${USER}/private/kept-private.webp`,
    `avatars/${OTHER}/avatar.webp`,
    `completions/${OTHER}/capture/theirs.webp`,
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("DELETE /api/account", () => {
  it("needs a signed-in user", async () => {
    session.user = null;
    const res = await DELETE(deleteRequest({ password: supabase.password }));
    expect(res.status).toBe(401);
    expect(session.rpcCalls).toEqual([]);
  });

  it("checks the password, deletes the account, and removes every file of theirs", async () => {
    const res = await DELETE(deleteRequest({ password: supabase.password, captchaToken: "token-1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(supabase.signIns).toEqual([
      { email: "alice@test.com", password: supabase.password, captchaToken: "token-1" },
    ]);
    expect(session.rpcCalls).toEqual([{ name: "delete_own_account", args: { p_user_id: USER } }]);

    // Their avatar and every check-in file, however deep in their folder it
    // sat. This is what used to be left behind: the files are one folder
    // down, and the folder names were what got handed to `remove`.
    expect([...supabase.stored].sort()).toEqual([
      `avatars/${OTHER}/avatar.webp`,
      `completions/${OTHER}/capture/theirs.webp`,
    ]);
    for (const path of supabase.removeCalls.flat()) {
      expect(path).toMatch(/\.(webp|mp4|webm)$/);
    }
  });

  it("deletes nothing on a wrong password", async () => {
    const res = await DELETE(deleteRequest({ password: "mistyped" }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid credentials");
    expect(session.rpcCalls).toEqual([]);
    expect(supabase.stored.size).toBe(7);
  });

  it("leaves the files alone when the account could not be deleted", async () => {
    session.rpcError = { message: "permission denied for table users", code: "42501" };

    const res = await DELETE(deleteRequest({ password: supabase.password }));
    expect(res.status).toBe(500);
    expect(supabase.stored.size).toBe(7);
  });

  it("still succeeds when storage cannot be reached: the account is gone, and the queue has the files", async () => {
    supabase.storageError = { message: "storage is down" };

    const res = await DELETE(deleteRequest({ password: supabase.password }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(session.rpcCalls).toHaveLength(1);
  });

  it("reports a server with no service key before deleting anything", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const res = await DELETE(deleteRequest({ password: supabase.password }));
    expect(res.status).toBe(500);
    expect(session.rpcCalls).toEqual([]);
  });
});

describe("DELETE /api/account for an account with no password", () => {
  beforeEach(() => {
    session.user = googleAccount();
  });

  it("deletes it on a sign-in from the last few minutes, asking for no password", async () => {
    session.claims = signedIn("oauth", 3);

    const res = await DELETE(deleteRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(supabase.signIns).toEqual([]);
    expect(session.rpcCalls).toEqual([{ name: "delete_own_account", args: { p_user_id: USER } }]);
    expect([...supabase.stored].every((file) => !file.includes(USER))).toBe(true);
  });

  it("asks it to sign in again when the sign-in was too long ago", async () => {
    session.claims = signedIn("oauth", 45);

    const res = await DELETE(deleteRequest({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Sign in again to delete your account",
      code: "reauth_required",
    });
    expect(session.rpcCalls).toEqual([]);
    expect(supabase.stored.size).toBe(7);
  });

  it("goes by when the session signed in, not by anything sent with the request", async () => {
    session.claims = signedIn("oauth", 45);

    const res = await DELETE(deleteRequest({ password: supabase.password, recentSignIn: true }));
    expect(res.status).toBe(401);
    expect(supabase.signIns).toEqual([]);
    expect(session.rpcCalls).toEqual([]);
  });

  it("falls back to the account's last sign-in when the token says nothing about its own", async () => {
    session.claims = null;

    session.user = { ...googleAccount(), last_sign_in_at: new Date(Date.now() - 2 * 60_000).toISOString() };
    expect((await DELETE(deleteRequest({}))).status).toBe(200);

    session.rpcCalls = [];
    session.user = { ...googleAccount(), last_sign_in_at: new Date(Date.now() - 60 * 60_000).toISOString() };
    expect((await DELETE(deleteRequest({}))).status).toBe(401);
    expect(session.rpcCalls).toEqual([]);
  });

  it("refuses when there is no telling when it signed in", async () => {
    session.claims = null;
    expect((await DELETE(deleteRequest({}))).status).toBe(401);
    expect(session.rpcCalls).toEqual([]);
  });
});

describe("DELETE /api/account for an account with a password", () => {
  it("still needs the password, however recently it signed in", async () => {
    session.claims = signedIn("password", 1);

    const res = await DELETE(deleteRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Password is required");
    expect(session.rpcCalls).toEqual([]);
  });

  it("needs it when Google is linked to the account as well", async () => {
    session.user = {
      id: USER,
      email: "alice@test.com",
      app_metadata: { provider: "email", providers: ["email", "google"] },
    };
    session.claims = signedIn("oauth", 1);

    expect((await DELETE(deleteRequest({}))).status).toBe(400);
    expect((await DELETE(deleteRequest({ password: supabase.password }))).status).toBe(200);
  });
});

describe("GET /api/account", () => {
  it("needs a signed-in user", async () => {
    session.user = null;
    expect((await GET()).status).toBe(401);
  });

  it("says a password account confirms with its password", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmWith: "password" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("says a Google account that just signed in has nothing more to show", async () => {
    session.user = googleAccount();
    session.claims = signedIn("oauth", 4);
    expect(await (await GET()).json()).toEqual({ confirmWith: "recent_sign_in" });
  });

  it("says a Google account that signed in a while ago signs in again", async () => {
    session.user = googleAccount();
    session.claims = signedIn("oauth", 11);
    expect(await (await GET()).json()).toEqual({ confirmWith: "sign_in_again" });
  });
});
