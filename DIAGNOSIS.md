# Phase 1 — Baseline measurements and diagnosis

## How this was measured

- Production build (`npm run build`, Next 16.1.6 + Turbopack), served with `npm start` on `:3111`.
- Browser: Chrome for Testing, Pixel 5 emulation, driven by Playwright.
- Throttling: **Slow 4G (1.6 Mbps down, 150 ms RTT) + 4× CPU**, applied over CDP.
- Backend: local Supabase, **behind a TCP latency proxy adding ~40 ms per hop**
  (`scratchpad/latency-proxy.mjs`, Supabase moved to :54331, proxy on :54321).
  Without this the local backend answers in ~1 ms, and *neither reported symptom
  reproduces at all* — see "What the evidence does not support" below.
- 5 runs per route (3 for secondary routes), median reported.

### One measurement caveat, stated up front

Chrome's CDP network emulation **does not throttle the main document over
loopback** — it throttles subresources only. So the `TTFB` column below is a
local-server number (~8 ms) and is *not* representative of production. Every
other metric is throttled normally. Where TTFB matters to the diagnosis I use
the **streamed-chunk arrival times** measured directly off the socket instead,
which are unaffected by this.

## Baseline metrics

| Route | FCP | LCP | TTFB¹ | CLS | TBT | JS transferred | JS decoded | JS reqs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/main/dashboard` (auth) | 728 ms | 728 ms | 8 ms | 0.000 | 48 ms | 360 KB | 1136 KB | 35 |
| `/main/feed` (auth) | 708 ms | **3972 ms** | 6 ms | 0.000 | 44 ms | 349 KB | 1102 KB | 34 |
| `/` (landing, static) | 852 ms | 1276 ms | 4 ms | 0.000 | 3 ms | 208 KB | 711 KB | 12 |

¹ loopback, not throttled — see caveat above.

### Server-side streaming timeline for `/main/dashboard`

Measured by timestamping raw response chunks off the socket (25 chunks, 101 KB):

| Arrives | Bytes | Content |
| --- | --- | --- |
| **10 ms** | 51 KB | `<head>`, `<body>`, TopBar, BottomNav, **and `MainContentSkeleton`** |
| **209 ms** | +37 KB | `Good morning, Alice` — `AuthGate` resolved |
| **397 ms** | +15 KB | `Morning Run` — `HabitsSection` resolved |

So the document is **fully streamed in ~400 ms**, in three flushes, with two
intermediate skeleton states of ~200 ms each.

### Skeleton flash census (measured, not inferred)

Counting elements with `animation-name: motive-shimmer` on screen over time:

| Route | Shimmer elements | Visible for | Verdict |
| --- | --- | --- | --- |
| `/main/feed` | 83 | **82 ms** | flash |
| `/main/profile` | 68 | **79 ms** | flash |
| `/main/friends` | 53 | **86 ms** | flash |
| `/main/inbox` | 43 | **84 ms** | flash |
| `/main/dashboard`, view restored to `week` | 1 | **290 ms**, starting at **t = 2691 ms** | flash, *after* the page already looked finished |

Nothing in the app holds a skeleton for as long as the 500 ms floor established
in RESEARCH.md; most are shown for under a tenth of a second.

---

## Root causes, ranked

### R1 — There is no app shell anywhere: not prerendered, not precached (blank screen)

`/main/*` first paint waits on a complete server round trip, every time, with
nothing to show in the meantime. Three independent things combine:

1. **Every route is dynamic.** Build output: only `/` and `/manifest.webmanifest`
   are `○ (Static)`; all 31 others including `/legal/*` and `/auth/login` are
   `ƒ (Dynamic)`. Nothing can be served from a CDN.
2. **The service worker refuses to cache the app's own screens.**
   `public/sw.js:117` — `var isAuthenticatedPage = url.pathname.startsWith("/main/")`
   and `:125` skips `cache.put` for them. The navigate handler (`:114–147`) is
   network-first with **no cached-shell fallback while online**; on failure it
   serves `/offline`.
3. **The render-blocking stylesheet is never precached.** Measured SW cache
   contents after a full dashboard load: **23 entries, 14 `.js`, `0 .css`.**

Measured consequence — reload `/main/dashboard` offline immediately after
successfully loading it:

```
status: 200
body: "📡\nYou're offline\n\nYour habits are safe..."
```

The user is shown the offline page for a screen they just had open. There is no
shell to paint, so on a cold or slow network the screen stays empty for the full
duration of the server round trip.

### R2 — The service-worker build step is broken and silently does nothing

`scripts/post-build.js` reads `manifest.pages["/_app"]` and
`manifest.pages["/main/dashboard"]` from `.next/build-manifest.json`. Those are
**Pages Router** keys. Verified against this build:

```
pages keys:  [ '/_app' ]
pages/_app:  []
rootMainFiles: [ 6 chunks ]     <- where App Router actually puts them
```

Build log confirms: `No critical assets found; SW precache unchanged.`
So `APP_SHELL` stays `["/", "/offline", "/manifest.webmanifest", "/icon-192.png"]`
— **no JS, no CSS ever precached.**

Worse, the script **rewrites the tracked file `public/sw.js` in place** with
`String.replace`, which replaces the *first* occurrence — and the first
occurrence of `__BUILD_ID__` was in the comment on line 4. The real token on
line 5 was consumed by some earlier build and committed. The result is a
permanently frozen cache version:

- `public/sw.js:5` → `var CACHE_VERSION = "U0tjyUVd2loiNjINbzybo";`
- current build id → `Sm-4FCExvjveu1XMrYhcv`
- cache name observed at runtime → `motive-vU0tjyUVd2loiNjINbzybo`

**The SW cache is never busted between deploys.** The `if (CACHE_VERSION === "__BUILD_" + "ID__")`
fallback guard on line 6 is dead code for the same reason.

### R3 — Four different skeleton geometries stack on a single dashboard load

| Layer | File | Composition |
| --- | --- | --- |
| 1 | `src/app/main/layout.tsx:97` `MainContentSkeleton` | title + progress + 3 cards |
| 2 | `src/app/main/loading.tsx` | **byte-identical duplicate of layer 1** |
| 3 | `src/app/main/dashboard/loading.tsx` | title + progress + **streak row** + **2 groups** |
| 4 | `src/app/main/dashboard/page.tsx:141` `HabitsSkeleton` | **view toggle** + progress + 3 cards |
| 5 | `src/app/main/dashboard/dashboard-client.tsx:16,20,24` | a bare `w-full h-64` gray rectangle |

Layers 3 and 4 disagree about whether there is a streak row and a view toggle;
layer 5 shares no visual language with any of them. Each layer's shimmer
animation starts when that element mounts, so the layers are also **out of phase
with each other** — `animation: motive-shimmer 1.2s linear infinite`
(`src/components/ui/Skeleton.tsx:23`) has no shared timeline.

This is the "two or three separate skeleton animations appearing and
disappearing independently" in the report.

### R4 — No delay-before-show and no minimum-display-time anywhere

`src/components/ui/Skeleton.tsx` renders immediately and unmounts immediately.
There is no timing hygiene in the codebase. Measured result: 79–86 ms flashes on
four routes (table above). Below ~100 ms a skeleton reads as a glitch, not as
feedback.

### R5 — `next/dynamic` view swap flashes a skeleton long after hydration

`dashboard-client.tsx:117` initializes `viewMode` to `"day"` for SSR, then
`:124–129` restores the stored value in an effect. For any user whose last view
was `week` or `month`, the stored view mounts **fresh on the client**, its chunk
is not yet downloaded, and `next/dynamic`'s `loading` fallback renders.

Measured: a single shimmer element appears at **t = 2691 ms** and is gone by
**t = 2980 ms** — a 290 ms gray box, ~2 seconds after the page already looked
complete. This matches "skeleton flicker *after hydration*" exactly.

### R6 — Server-side request waterfall: 4 sequential round trips before content

`getAuthUser()` → `getProfile(user.id)` → `Promise.all([habits, challenges])` →
`Promise.all([completions, participants])`. The third pair cannot start until
the profile resolves (it needs the timezone); the fourth cannot start until
`habitIds` exist — that one is a genuine data dependency, the first two are not.

Visible in the chunk timeline as the 10 ms → 209 ms → 397 ms steps.

### R7 — Client-side auth waterfall in the persistent chrome

`src/lib/hooks/useAuthUserId.ts` — `useEffect` → `getSession()` → `setState`.
Every badge query in `TopBar` and `BottomNav` is `enabled: !!userId`, so none of
them can start until that effect has run and re-rendered. Two extra serial
client round trips after hydration for data the server already had.

### R8 — 1.1 MB of JavaScript on the dashboard, including two large libraries nothing on screen needs

360 KB transferred / 1136 KB decoded / 35 requests. Largest chunks, identified
by fingerprinting library-specific symbols in the minified output:

| Chunk | Size | Contains |
| --- | --- | --- |
| `89b214c1…` | 219 KB | `react-dom` |
| `6665377d…` | 199 KB | `@supabase/supabase-js` — **including `RealtimeClient`** |
| `2b42d137…` | 113 KB | `motion` |
| `aca961db…` | 80 KB | Radix + `date-fns` |
| `752047ae…` | 66 KB | `@tanstack/react-query` + `lucide-react` |

- **`motion` (113 KB) is on the dashboard critical path solely for
  `InstallPrompt`** (`src/components/pwa/InstallPrompt.tsx:4`), which is rendered
  unconditionally in `src/app/main/layout.tsx:103` and renders nothing for most
  users on most visits.
- **`RealtimeClient` ships to every route** because `src/components/providers.tsx:10`
  imports `createClient`. Only the feed uses realtime.

### R9 — `npm run analyze` produces nothing

`@next/bundle-analyzer` is a webpack plugin; this project builds with Turbopack.
`ANALYZE=true next build` completes and emits no report. The bundle table above
had to be produced by fingerprinting chunks by hand.

### R10 — Manifest colors don't match the app, and there is no dark variant

`src/app/manifest.ts:13–14` — `background_color: "#FAFAF9"`, `theme_color: "#6366F1"`.
The document's actual colors (`src/app/layout.tsx:33–36`) are `#fafaf9` light /
`#1a1a1e` dark. So an installed PWA launched in dark mode shows a **light splash
screen with an indigo status bar**, then paints a near-black app. Per MDN, the
manifest `background_color` should match the stylesheet's background.

### R11 — `prefers-reduced-motion` is never honored

`grep -rn "prefers-reduced-motion" src` → **0 matches.** The shimmer, the
`dv-stagger-container` entrance animations, the streak particles and the flyout
all animate unconditionally.

---

## What the evidence does *not* support

The brief listed several plausible causes. These were checked and are **not**
what is happening here — I'd rather say so than manufacture agreement.

| Hypothesis from the brief | Finding |
| --- | --- |
| Root layout or a top-level provider is a Client Component forcing the tree client-side | **No.** `src/app/layout.tsx` is a Server Component. `Providers` is a client component but receives `children` as a prop, so the subtree still renders on the server. |
| A provider gates render until ready (`if (!ready) return null`) | **No.** `src/components/providers.tsx:136–139` renders `{children}` unconditionally. `PersistQueryClientProvider` does not block children on IndexedDB restore. |
| Root layout's `await headers()` blocks the shell | **No — measured.** The shell arrives at **10 ms**. `headers()` resolves at request time and costs nothing. It *does* force every route dynamic (R1.1), which matters, but it is not what delays paint. |
| Missing/black `background_color` causes a literally black splash | **No.** `theme-color` meta tags *are* emitted (`#fafaf9` / `#1a1a1e`, verified in served HTML at byte 2383), and the inline theme-init script sets `documentElement.style.background` before first paint. The manifest colors are wrong (R10) but they produce a *light* splash, not a black one. |
| A blocking font or third-party script in the critical path | **No.** Fonts are self-hosted via `next/font` with `display: "swap"`. Turnstile is `dns-prefetch` only. Vercel Analytics/Speed Insights load async. |
| Skeleton markup dimensions cause layout shift | **Not currently.** **CLS is 0.000 on every route measured.** The geometry mismatches in R3 are real, but today they resolve before paint. The goal here is to *keep* CLS at zero while restructuring. |
| CSP is blocking Next's inline RSC scripts | **No.** Verified in the served HTML: Next stamps its own nonce onto every script tag, matching the response CSP. |
| Hydration mismatches | **None.** Console clean across `/main/dashboard`, `/main/feed`, `/main/friends`, `/main/profile`. |

### And one important qualification on the symptoms themselves

**Neither symptom reproduces against a zero-latency backend.** With local
Supabase answering in ~1 ms, the whole document streams before FCP, so no
Suspense fallback ever becomes visible and the dashboard paints complete at
~716 ms. Both symptoms are **latency-amplified**: they appear exactly when the
server's round trips push the intermediate Suspense states past first paint —
which is the normal condition in production, where Supabase is remote.

That also means the honest framing of the "multi-second blank screen" is not
"something is slow in the render", it is: **nothing is cached or prerendered, so
the first paint is pinned to the slowest thing in the chain, and there is no
shell to fill the gap.** That is R1, and it is the fix with the largest
user-visible win.

---

# Phase 3 — Verification

Same production build, same harness, same throttling (Slow 4G + 4× CPU,
Pixel 5, Supabase behind the +40 ms/hop latency proxy), median of 5 runs
(3 for feed/landing).

## Core Web Vitals

| Route | Metric | Before | After | |
| --- | --- | --- | --- | --- |
| `/main/dashboard` | FCP | 728 ms | 708 ms | — |
| | LCP | 728 ms | 708 ms | — |
| | TTFB¹ | 8.7 ms | 7.6 ms | — |
| | CLS | 0.000 | 0.000 | held at zero |
| | TBT | 46 ms | 45 ms | — |
| | `load` | 2543 ms | 2308 ms | **−9%** |
| | JS transferred | 360 KB | 325 KB | **−10%** |
| | JS decoded | 1136 KB | 1006 KB | **−11%** |
| | JS requests | 35 | 33 | −2 |
| `/main/feed` | FCP | 708 ms | 704 ms | — |
| | **LCP** | **3972 ms** | **880 ms** | **−78%** |
| | CLS | 0.000 | 0.000 | held at zero |
| | JS transferred | 349 KB | 306 KB | **−12%** |
| `/` (landing) | FCP | 852 ms | 860 ms | untouched |
| | LCP | 1276 ms | 1272 ms | untouched |

¹ loopback, not throttled — see the caveat at the top of this file. Unchanged
by design: the dashboard is per-user and must render on demand.

## Bundle

| | Before | After |
| --- | --- | --- |
| `/main/dashboard` route chunks | 511 KB | **387 KB** |
| `motion` on the dashboard critical path | yes (113 KB) | **no** |

## Loading behavior

Measuring skeletons that are **actually painted** (in the DOM, and past the
reveal delay — the earlier probe counted DOM presence, which overstates it):

| Route | Before | After |
| --- | --- | --- |
| `/main/dashboard` | — | **0 visible skeleton states** |
| `/main/feed` | 83 blocks visible for **82 ms** | **0** |
| `/main/friends` | 53 blocks visible for **86 ms** | **0** |
| `/main/inbox` | 43 blocks visible for **84 ms** | **0** |
| `/main/profile` | 68 blocks visible for **79 ms** | **0** |
| `/main/dashboard`, view = `week` | 1 block at t=2691 ms for **290 ms** | **0** |
| `/main/dashboard`, view = `month` | (same mechanism) | **0** |

Every one of these now resolves inside the 200 ms delay window, so no skeleton
is painted at all. CLS stayed 0.0000 throughout.

### …but skeletons still work when the wait is real

The point is not to hide skeletons, so the same trace was run with the backend
slowed to +400 ms/hop:

| | Before | After |
| --- | --- | --- |
| visible skeleton states | 2 | **1** |
| first state held for | 1496 ms | **1481 ms** |
| second state | 15 blocks for **57 ms** (flash) | **gone** |
| states shorter than 500 ms | 1 | **0** |

One coordinated loading state, held well past the 500 ms floor, then content.

## Service worker

| | Before | After |
| --- | --- | --- |
| cache name | `motive-vU0tjyUVd2loiNjINbzybo` | `motive-v<current BUILD_ID>` |
| …tracks the build id? | **no** — frozen across two different builds (`Sm-4FCExvjveu1XMrYhcv`, `MDf7r1f51lxHFueVepkqi`), reproduced in a clean worktree | **yes** |
| CSS precached | **0** | **1** (the render-blocking stylesheet) |
| shell JS precached at install | **0** (the 12–14 JS entries were incidental runtime caching of prefetches) | **17** |
| build log | `No critical assets found; SW precache unchanged.` | `18 precached shell assets, 1 css / 17 js` |
| authenticated RSC payloads in cache | **yes** — `/main/feed`, `/main/profile`, `/main/dashboard`, `/main/friends`, `/main/inbox` | **no** — only `/`, `/offline`, `/manifest.webmanifest`, `/icon-192.png` |

### Scenario checks (installed PWA, `--app=` launch)

| Scenario | Result |
| --- | --- |
| First visit, cold cache | works; FCP 708 ms |
| Repeat visit, warm cache | works; FCP 240 ms, LCP 404 ms, 55/57 resources served without network |
| Offline, `/main/dashboard` | serves the offline page (intended — authenticated HTML is deliberately not cached) |
| Offline, `/` | serves the landing page from cache |
| Installed PWA launch | SW controls, 35 JS + 1 CSS precached, offline behaves as above |

**Honest note on the repeat visit:** the before/after timings there are
effectively identical (FCP 244 ms vs 240 ms), because `/_next/static/*` is
immutable and the browser's own HTTP cache already served it. The SW precache
work is not what makes a warm repeat visit fast. What it actually buys is
correctness in the cases the HTTP cache doesn't cover: a correctly-versioned
cache across deploys, and a shell that survives HTTP-cache eviction. Claiming a
timing win here would misrepresent the measurement.

## Other checks

| Check | Result |
| --- | --- |
| Hydration mismatches | none, across dashboard / feed / friends / profile |
| CSP violations | none |
| `prefers-reduced-motion: reduce` | shimmer `none`, stagger entrances `none`, 200 ms reveal delay preserved (it is timing, not motion) |
| Lint | 3 errors — **the same 3 that exist on `HEAD`**, in files not touched here |
| Unit tests | 178 passing / 22 failing — **the same 22 failures as `HEAD`**; 15 new tests added and passing |

---

# Phase 4 — Follow-up evaluation (realtime split, CSS inlining)

Two follow-ups were left open. Both were evaluated against the same harness
(now committed under `tests/perf/`). A third cause, found while investigating,
turned out to matter more than either.

## R12 — The render-blocking stylesheet loses a bandwidth race to font preloads

`next/font` preloads by default, so `src/app/layout.tsx` emitted two
`<link rel=preload as=font>` tags (36 KB + 48 KB of woff2) **ahead of** the
14 KB render-blocking stylesheet. Measured on `/main/dashboard`, cold:

| Resource | start | end | transfer | render-blocking |
| --- | --- | --- | --- | --- |
| font (Inter) | 171 ms | 865 ms | 48 KB | no |
| font (DM Sans) | 171 ms | 1108 ms | 36 KB | no |
| **stylesheet** | 180 ms | **549 ms** | 14 KB | **yes** |

14 KB should transfer in ~70 ms at this bandwidth; it took 369 ms because
84 KB of font bytes were in flight alongside it. Every face already used
`display: "swap"`, so none of them was ever render-blocking — only their
*preloads* were competing.

**Change trialled:** `preload: false` on all three faces. The stylesheet then
started at 168 ms and finished at 415 ms with **0 KB of font bytes competing**,
moving `/main/dashboard` from 712 ms to 476 ms on both FCP and LCP.

**Reverted** — see R13. It pushed the *reported* LCP on `/main/feed` from
864 ms to 1652 ms without changing anything visible, and Core Web Vitals is what
gets measured in the field. Final config: **Inter and DM Sans preloaded,
JetBrains Mono not** (`src/app/layout.tsx`), which is where this started. The
finding is kept on the record because the mechanism is real and the comment in
`layout.tsx` now documents why the preloads must stay.

## The three configurations, measured

| Config | dash FCP | dash LCP | dash CLS | feed FCP | feed LCP |
| --- | --- | --- | --- | --- | --- |
| no preloads | **476** | **476** | 0.0004 | **472** | 1652 |
| Inter only | 640 | 640 | 0.0004 | 628 | 1632 |
| **Inter + DM Sans (shipped)** | 708 | 708 | **0.0000** | 704 | **876** |

Two things worth keeping:

**Preloading Inter alone is a dominated option** — worse first paint than no
preloads, and it does *not* recover feed LCP. The LCP re-stamp tracks all faces
settling, not just the one the text is rendered in, so the two above-the-fold
faces have to be preloaded together or not at all.

**Dropping the preloads also moved CLS off zero** (0.0004, consistently across
5 runs — the irreducible residue of `next/font`'s automatic metric matching,
which already emits `size-adjust: 107.12%` and `ascent-override`). Restoring
them puts it back to exactly 0.0000.

`display: "optional"` was also measured as an alternative: identical timings with
CLS back to exactly 0.0000, but it means the custom faces may never apply on a
first visit. Rejected as a visible brand change rather than a performance one.

## Verdict: realtime split — not done, and not worth doing

- `SupabaseClient`'s constructor **unconditionally** instantiates a
  `RealtimeClient` (`dist/index.mjs:226`, `_initRealtimeClient` at :358). No
  lazy getter, no option, no realtime-free sub-path in the `exports` map.
  `sideEffects: false` cannot help — it is a constructor call, not a dead import.
- `@supabase/ssr@0.8.0`'s `createBrowserClient` calls supabase-js `createClient`,
  so the full client arrives transitively.
- A split therefore means dropping `@supabase/ssr`'s browser client and
  hand-composing `auth-js` + `postgrest-js` + `storage-js`, reimplementing the
  cookie-backed session storage, across all 34 importers of
  `src/lib/supabase/client.ts`.
- Payoff: `realtime-js` is ~94 KB of ~400 KB of unminified supabase surface →
  roughly **23% of the 199 KB chunk ≈ 13 KB gzipped**, about **4%** of the
  317 KB transferred, with **no FCP or LCP effect at all** (those scripts are
  `async`; TBT is already ~45 ms).

Only 4 files use realtime, all on feed/friends routes — the *usage* is cleanly
isolated. The blocker is purely that the library cannot be constructed without
it. **Revisit if supabase-js ships a realtime-free entry point.**

## Verdict: CSS inlining — trialled, measured, reverted

True critical-CSS extraction is unavailable on the App Router:
`experimental.optimizeCss` (critters/beasties) needs the fully rendered HTML and
is incompatible with streaming. The only option is
`experimental.inlineCss`, which inlines the **whole** sheet as `<style>`.

Trialled and measured:

| | without | with `inlineCss` | |
| --- | --- | --- | --- |
| cold FCP | 476 ms | **284 ms** | −192 ms |
| cold LCP | 476 ms | **628 ms** | **+152 ms** |
| warm (SW) FCP | 232 ms | 284 ms | **+52 ms** |
| warm (SW) LCP | 416 ms | 536 ms | **+120 ms** |

**Reverted.** Without it, FCP and LCP are the same number (476 ms) — the whole
dashboard arrives at once. With it, they diverge by 344 ms: the shell paints at
284 ms and the content lands at 628 ms. That is a two-stage reveal, which is the
exact symptom this project set out to remove. It also regresses the warm case on
both metrics, and leaves the SW precaching a stylesheet nothing references.

## Also done: CSS hygiene

- Deleted `src/styles/globals.css` — 0 bytes, nothing imported it.
- Deleted `tailwind.config.ts` — **Tailwind v4 never loaded it.** v4 only reads a
  JS/TS config via an `@config` directive, and no CSS file has one; the utilities
  that appear to come from it (`bg-brand`, `font-display`) are generated by the
  `@theme inline` block in `src/app/globals.css`. Keeping it was a trap: edits
  would have silently done nothing. Verified by diffing the emitted CSS before
  and after — **every utility rule is byte-identical**; the only change is three
  now-unused `--shadow-*` theme variables dropped (185 bytes).
- Skipped trimming Tailwind's default `@layer theme` (6.7 KB raw, ~1 KB gz ≈ 5 ms
  at this bandwidth) — not worth the risk of silently dropping a utility.

## R13 — The `/main/feed` LCP number is a re-stamp, not a delay

The feed's LCP element is a body-text `<p>` ("Bob completed 💧 Drink Water · …").
Eight instrumented experiments, tracking that exact element by tagging every
LCP-sized node and reading the identity back off the `LargestContentfulPaint`
entry:

**What the element actually does** (current config, throttled):

| t | state |
| --- | --- |
| 463 ms | in the DOM, **final laid-out size 3568 px²**, effective opacity 0 |
| 599 ms | opacity 0.25, size unchanged |
| 877 ms | **opacity 1.0**, size unchanged, position settled |
| 1652 ms | **LCP entry emitted** |

So the content is laid out at its final size by 463 ms and fully visible by
877 ms. Nothing about it changes between 877 ms and the LCP stamp.

**Causes ruled out, each with evidence:**

| Hypothesis | Ruled out by |
| --- | --- |
| Font swap reflowing the text | `font-display: optional` — verified applied on all 15 faces in the emitted CSS and in `document.fonts` (`"Inter optional"`) — left the stamp at 1644 ms |
| The H1 shrinking on swap and demoting itself | Preloading DM Sans (the H1's face) landed it at 585 ms; the stamp moved *later*, to 1863 ms |
| Entrance-animation opacity gating | Effective opacity reaches 1.0 at 877 ms |
| DOM replacement by the nested Suspense boundary | The node's probe id is stable from 463 ms — it is never replaced |
| Main thread blocked / frames not presenting | **No `requestAnimationFrame` gaps >100 ms**, and the only long tasks are at 2118 ms and 2274 ms — both *after* the stamp |

**Best-supported explanation (correlation, not proof).** Across all four font
configurations measured, the stamp lands within ~35 ms of *a webfont download
completing* — including under `display: optional`, where the face is never
applied:

| Config | first font done | stamp |
| --- | --- | --- |
| both preloaded (original) | ~865 ms | 856 ms |
| no preloads | 1658 ms | 1692 ms |
| `display: optional`, no preloads | ~1658 ms | 1644 ms |
| DM Sans preloaded only | 585 ms (Inter 1831 ms) | 1863 ms |

That is consistent with Chrome re-emitting the LCP candidate when a font load
completes and invalidates the text paint, even when the painted result is
identical. I could not confirm this from outside the browser, so it stays
labeled a hypothesis.

**Outcome.** This was a product call between a real ~240 ms improvement in when
content appears and a ~790 ms improvement in the number the field reports, and
it was decided in favour of the reported metric: Core Web Vitals is what gets
measured by real users and by search ranking, and a number nobody can see is
still a number that counts. The font preloads were restored (R12).

Preloading Inter alone was measured first and rejected: feed LCP stayed at
1632 ms — unchanged — while first paint still cost 164 ms. The re-stamp tracks
*all* faces settling, so Inter and DM Sans have to be preloaded together.

**What is still on the table.** The mechanism in R12 is real: 84 KB of font
preloads genuinely do delay a 14 KB render-blocking stylesheet by ~370 ms. Ways
to get that back without the LCP cost, none of them attempted here:

- Subset the two faces harder (they are already `latin`-only, but variable-font
  axes and glyph coverage could be trimmed) so the preloads cost less bandwidth.
- Self-host a single variable face and drop DM Sans, removing one preload
  entirely — a design decision, not a performance one.
- Serve over HTTP/2/3 in production (this harness measures HTTP/1.1 on
  loopback), where prioritization may let the stylesheet win without dropping
  the preloads. **Worth re-measuring against a real deployment before doing
  anything else here** — the contention may be materially smaller there.

---

# Phase 5 — Does Cache Components solve any of this?

`cacheComponents` was rejected in RESEARCH.md up front as out of scope. It was
later revisited properly, because the wall hit in Phase 2 — a nonce-based CSP
being incompatible with static prerendering — is exactly what it might change.
It was prototyped end to end in a throwaway worktree.

**Verdict: no, and it cannot be adopted here without weakening the CSP.**

## What it promises

`cacheComponents: true` is **stable** in 16.0.0 (a top-level config, not under
`experimental`). It makes Partial Prerendering the default: a static HTML shell
is prerendered and served immediately while dynamic content streams in. That is
precisely the app-shell shape R1 called for.

## Getting it to build

Worked through end to end. In order:

1. **Route segment configs** — `dynamic` and `revalidate` in 7 files must go.
   Mechanical.
2. **The root layout's `await headers()`** — build error on every route,
   including `/_not-found`: *"Uncached data was accessed outside of
   `<Suspense>`"*. This read exists solely to get the CSP nonce, and it cannot
   be wrapped in a boundary, because the nonce is consumed by a `<script>` in
   `<head>` (the docs call this case out for `<html>` attributes). **Removing it
   is mandatory.**
3. **`usePathname()` in `Providers`** — suspends on dynamic-param routes. Fixed
   by pushing the read into a leaf inside `<Suspense>`.
4. **`usePathname()` in `BottomNav`** — same. Fixed by splitting the nav into a
   static shell (full bar, correct geometry, no active highlight, no badges)
   behind a boundary carrying the live version. This is a genuinely better
   shape and would be worth doing regardless.
5. **Synchronous IO during prerender** — `Math.random()` in
   `auth/habit-facts.tsx` (which was also a latent hydration mismatch).

`instant = false` does **not** defer any of these. The documented
`cache-components-instant-false` codemod was run — it added the export to 22
segments and the build failed at exactly the same place. These are prerender
errors, not validation insights.

After those fixes the build passes, and every route prerenders:

```
○ /  ○ /auth/login  ○ /legal/*  ○ /offline        (Static)
◐ /main/dashboard  ◐ /main/feed  ◐ /main/profile  (Partial Prerender)
```

## Then it breaks, unfixably

With no nonce, Next.js's own inline RSC bootstrap scripts carry nothing for
`script-src` to match:

```
Executing inline script violates the following Content Security Policy
directive 'script-src 'self' 'sha256-GHmofR…' https://challenges.cloudflare.com'
```

The app never hydrates — logging in fails. This is not a bug; the CSP docs state
it directly:

> To use a nonce, your page must be **dynamically rendered**. […] Static pages
> are generated at build time, when no request or response headers exist—so no
> nonce can be injected.
> **Partial Prerendering (PPR) is incompatible** with nonce-based CSP since
> static shell scripts won't have access to the nonce.

**`experimental.sri` does not rescue it.** The docs offer it as the hash-based
alternative that "allows you to maintain static generation while still having a
strict CSP". Enabled with `algorithm: "sha256"`, it emitted **zero `integrity`
attributes** under Turbopack, and the inline scripts were still bare. The
violation was unchanged. SRI hashes external script *files*; the blocked scripts
are inline RSC payloads, which differ per route and per render and cannot be
hashed ahead of time.

That leaves `script-src 'unsafe-inline'` as the only way to run Cache Components
here — which defeats the main thing this app's CSP exists to prevent. Not a
performance trade; a security-posture change.

## And the payoff would have been ~0 anyway

Timing the raw HTML flush for `/main/dashboard`, same machine, same backend:

| Build | first chunk | shell markup present |
| --- | --- | --- |
| current (nonce, dynamic) | **43 ms** (13.4 KB) | `MotiveFaith` + `Main navigation` at 43 ms |
| cacheComponents (PPR) | **42 ms** (16.8 KB) | `MotiveFaith` + `Main navigation` at 42 ms |

Identical. This is the Phase 1 finding again: **the shell was never slow.** It
was already in the first flush at 10 ms. The blank screen came from the
render-blocking stylesheet and from nothing being cached — both addressed by
other means (R2, R12). PPR optimizes the part that was already fast.

It would help where this harness cannot measure: in production a dynamic route
costs a server round trip (serverless cold start included) that a CDN-served
static shell avoids. That is a real saving on TTFB — but FCP here is bounded by
the stylesheet, not TTFB, so the saving would be largely absorbed.

## What was worth keeping

Three findings from the prototype stand on their own and are **not** done here:

- `BottomNav` splitting into a static shell plus a live layer is the right
  shape for an app shell, independent of PPR.
- `Math.random()` in a `useState` initializer (`auth/habit-facts.tsx:61`) is a
  real latent hydration mismatch — server and client pick different facts.
- `usePathname()` high in the tree (`providers.tsx`) forces work down the whole
  subtree.

## Re-evaluate when

Next.js supports nonce injection into a prerendered shell, or ships a
CSP story for PPR that does not require `'unsafe-inline'`. Until then the CSP
is the binding constraint, and it is the right thing to keep.

---

# Phase 6 — The three findings the Cache Components prototype surfaced

Three problems the Phase 5 prototype exposed that stand on their own. All three
were investigated before being implemented; one turned out to be worth less than
it looked.

## R14 — The auth pages swapped their fact ~1.7s after first paint

`src/app/auth/habit-facts.tsx` picked its starting fact with `Math.random()` in
a `useState` initializer. That runs during SSR too, so the server and the client
chose **different** facts.

React never warned about the mismatch. `FactCard` is keyed by the fact text, so
React silently unmounted the server's node and mounted a new one instead of
reporting a text mismatch — which is exactly why this survived every earlier
console check for hydration warnings.

It was very visible to the user. Measured on `/auth/signup`, Slow 4G + 4× CPU,
sampling the rendered text every 20ms:

| | before | after |
| --- | --- | --- |
| fact on screen at ~600ms | one fact | one fact |
| replaced at ~2310ms by a different one | **5 / 5 runs** | **0 / 3 runs** |
| server HTML identical across requests | no (3 different facts in 3 curls) | yes |

**Fix:** first render is index 0 — deterministic, so server and client agree —
and the random offset is applied on the first cycle tick instead, a full
interval after paint where it is indistinguishable from normal rotation.
Pinned by `src/app/auth/__tests__/habit-facts.test.tsx` (3 tests), including
one that spies on `Math.random` to assert it is *not* called during render.

## R15 — `usePathname()` sat on the provider that wraps the whole app

`src/components/providers.tsx` read `usePathname()` at the top of `Providers`
purely to decide whether to mount the auth-only hooks. `Providers` wraps every
route, so that subscribed the entire provider tree to route changes.

**Fix:** moved the read into an `AuthHooksGate` leaf that renders `null`. Same
behavior, subscription narrowed to a component with no output, and the read is
out of the way of prerendering (where it suspends on dynamic-param routes).

## R16 — The BottomNav Suspense boundary: refactor kept, boundary rejected

The prototype split `BottomNav` into a static shell plus a live layer. Two
things were wrong with carrying that over verbatim.

**It duplicated the markup.** The prototype hand-wrote a second copy of the nav
alongside the real one — which drifts silently the first time someone edits one
and not the other. Replaced with a single `NavBar` that takes everything
request-dependent (`pathname`, the two badge flags) as props, so one render
produces both versions.

**The boundary costs ~14ms of TBT and does nothing.** `usePathname()` only
suspends during prerendering, which this app does not do for `/main/*` — the
CSP nonce forces dynamic rendering (Phase 5). Verified directly: the server HTML
contains the nav *with* `aria-current="page"` set, so the fallback never
renders. And it is not free:

| | TBT |
| --- | --- |
| baseline (before any of this) | 45–47 ms |
| with the Suspense boundary | **60–62 ms** (three 5-run samples) |
| shared `NavBar`, no boundary | **47 ms** |

An inert wrapper with a reproducible cost is a bad trade, so the boundary was
dropped and the refactor kept. `BottomNav.tsx` documents the measurement and
shows the three-line addition that reinstates it if the CSP constraint lifts.

## Verification

Final state, same harness:

| Check | Result |
| --- | --- |
| `/main/dashboard` | FCP 712 ms, LCP 712 ms, CLS 0.0000, TBT 48 ms — baseline |
| `/main/feed` | FCP 704 ms, LCP 856 ms, CLS 0.0000 — baseline |
| repeat visit (SW) | FCP 228 ms, CLS 0.0000, 55/57 resources off-network |
| nav active item | correct on all four main routes, and present in the server HTML |
| fact swap | gone, 3/3 runs |
| skeletons | 0 visible states on all four routes |
| offline / installed PWA | unchanged |
| hydration warnings / CSP violations | none |
| tests | 208 passing (22 files) |
| lint / tsc | 0 errors, 0 warnings / clean |
