/**
 * Capture a session for a seeded local user WITHOUT the login form.
 *
 * `login.mjs` drives the real form, which fails while `[auth.captcha]` is
 * enabled in supabase/config.toml — GoTrue answers "captcha verification
 * process failed" and no session is issued. The README's workaround is to
 * disable captcha and restart Supabase; this script avoids both by minting a
 * session through the admin API and writing the cookies exactly as
 * @supabase/ssr would, using its own chunker and encoder.
 *
 * Usage:
 *   SERVICE_ROLE_JWT=$(npx supabase status -o json | jq -r .SERVICE_ROLE_KEY) \
 *     node tests/perf/login-admin.mjs [email] [outPath]
 *
 * SERVICE_ROLE_JWT is only needed when .env.local holds a new-style
 * `sb_secret_…` key — the admin endpoints want the legacy JWT service role key.
 */
import { readFile, writeFile } from "fs/promises";
import { createChunks } from "@supabase/ssr/dist/main/utils/chunker.js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const email = process.argv[2] ?? "alice@test.com";
const out = process.argv[3] ?? "tests/perf/auth.json";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8")).split("\n")
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);

const base = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = process.env.SERVICE_ROLE_JWT ?? env.SUPABASE_SERVICE_ROLE_KEY;

const linkRes = await fetch(`${base}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: admin, Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email }),
});
const link = await linkRes.json();
if (!linkRes.ok) {
  console.error("generate_link failed:", link);
  console.error("If this is a 401, pass the legacy JWT via SERVICE_ROLE_JWT — see the header.");
  process.exit(1);
}

// Verifying an admin-generated token_hash is not captcha-guarded.
const res = await fetch(`${base}/auth/v1/verify`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }),
});
const session = await res.json();
if (!res.ok || !session.access_token) {
  console.error("verify failed:", session);
  process.exit(1);
}

// Cookie name and encoding must match supabase-js / @supabase/ssr exactly:
// `sb-<first hostname label>-auth-token`, value `base64-<base64url(json)>`,
// chunked at MAX_CHUNK_SIZE.
const key = `sb-${new URL(base).hostname.split(".")[0]}-auth-token`;
const encoded = "base64-" + stringToBase64URL(JSON.stringify(session));
const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

const cookies = createChunks(key, encoded).map(({ name, value }) => ({
  name, value, domain: "localhost", path: "/", expires,
  httpOnly: false, secure: false, sameSite: "Lax",
}));

await writeFile(out, JSON.stringify({ cookies, origins: [] }, null, 2), "utf8");
console.log(`saved ${out} — ${session.user?.email}, cookie "${key}" in ${cookies.length} chunk(s)`);
