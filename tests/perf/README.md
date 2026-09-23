# Performance harness

Scripts used to diagnose and verify the first-load / loading-state work.
See `DIAGNOSIS.md` at the repo root for the findings these produced.

They are **not** part of `npm test` — they need a running production build, a
seeded local Supabase, and a real browser, so they're run by hand.

## Setup

```bash
# 1. Local Supabase, with the API moved aside so a latency proxy can sit on 54321.
#    In supabase/config.toml, temporarily set [api] port = 54331 and
#    [auth.captcha] enabled = false, then:
npx supabase start

# 2. Latency proxy — makes the local backend behave like a hosted one.
#    Without it the backend answers in ~1ms and none of the symptoms reproduce.
LISTEN_PORT=54321 UPSTREAM_PORT=54331 DELAY_MS=40 node tests/perf/latency-proxy.mjs &

# 3. Production build + server
npm run build && PORT=3111 npm start &

# 4. Capture a session for the seeded dev user (writes tests/perf/auth.json, gitignored)
export CHROME_BIN="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
node tests/perf/login.mjs http://localhost:3111

# If captcha is enabled in supabase/config.toml, login.mjs cannot sign in
# ("captcha verification process failed"). Either disable it there, or skip the
# form entirely — the admin API is not captcha-guarded:
SERVICE_ROLE_JWT=$(npx supabase status -o json | jq -r .SERVICE_ROLE_KEY) \
  node tests/perf/login-admin.mjs
```

**Restore `supabase/config.toml` when you're done.**

## Scripts

| Script | What it measures |
| --- | --- |
| `measure.mjs <label> <url> [--auth=path] [--runs=N] [--sw]` | FCP / LCP / TTFB / CLS / TBT, JS transferred and decoded, and the **critical-path resource race** (stylesheet vs. font preloads) |
| `visibletrace.mjs <url> <label> [viewCookie]` | Skeletons that are *actually painted* — in the DOM and past the reveal delay. Samples from document_start, not DOMContentLoaded (a streamed response fires that only once the stream completes) |
| `swmeasure.mjs <label> <url> [--standalone]` | Repeat visit with the service worker controlling; reports precache contents |
| `offlinecheck.mjs <base> [authPath] [--standalone]` | Precache contents, offline behavior, installed-PWA launch |
| `console.mjs <path...>` | Console errors, CSP violations, hydration warnings |
| `latency-proxy.mjs` | TCP proxy adding `DELAY_MS` per direction to the first chunk of each burst |
| `login-admin.mjs [email] [out]` | Captures a session **without** the login form, for when `[auth.captcha]` is enabled and `login.mjs` cannot get past it |

## Throttling

Slow 4G (1.6 Mbps down, 150 ms RTT) + 4x CPU, Pixel 5 emulation, median of N runs.

**Known limitation:** Chrome's CDP network emulation does not throttle the main
document over loopback — only subresources. Document TTFB therefore reads ~8 ms
cold and is not comparable to production. Where document timing matters, read
the streamed chunk arrival times off the socket instead.
