# Phase 0 — Research Log

Grounding for the first-load / loading-state work. Every technique below was
confirmed against the docs for the versions actually installed in this repo,
not from memory.

## Installed versions (from `package.json` + `package-lock.json`)

| Package | Version | Notes |
| --- | --- | --- |
| `next` | **16.1.6** | App Router, Turbopack build (`▲ Next.js 16.1.6 (Turbopack)`) |
| `react` | **19.2.3** | |
| `react-dom` | **19.2.3** | |
| `@tanstack/react-query` | ^5.90.20 | |
| `@tanstack/react-query-persist-client` | ^5.96.2 | IndexedDB cache restore |
| `idb-keyval` | ^6.2.2 | persister backing store |
| PWA / service worker | **none** | No `next-pwa`, no `@serwist/next`, no `workbox`. Hand-rolled `public/sw.js` + `scripts/post-build.js` string-replacement injector. `src/app/sw.ts` is a 13-line doc comment, not the SW source. |

Docs fetched were served as **version 16.3.5** of the Next.js documentation.
Where 16.3.x describes behavior newer than 16.1.6, that is called out below.

## Techniques I intend to use

| # | Technique | Applies to | Confirmed against |
| --- | --- | --- | --- |
| 1 | Keep the **root layout free of request-time APIs** (`headers()`, `cookies()`), so the route can prerender and `loading.tsx` can actually show a fallback | Next 16.1.6 (no Cache Components) | <https://nextjs.org/docs/app/api-reference/file-conventions/layout> — *"Interaction with `loading.js`"*: **"Without Cache Components: The navigation will block until the layout finishes rendering, and the `loading.js` fallback will not be shown."** |
| 2 | **CSP hashes instead of a per-request nonce** for a fixed inline script, so no `headers()` read is needed | CSP spec / proxy.ts | <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src> (hash-source) |
| 3 | `loading.tsx` = automatic `<Suspense>` around `page.js` and below; it does **not** wrap `layout.js`/`template.js`/`error.js` of the same segment | Next 16.1.6 | <https://nextjs.org/docs/app/api-reference/file-conventions/loading> |
| 4 | Streaming SSR via `<Suspense>` in Server Components; fallback ships in the initial HTML, content streams after | React 19.2 / Next 16 | <https://nextjs.org/docs/app/api-reference/file-conventions/loading#streaming-with-suspense>, <https://react.dev/reference/react/Suspense> |
| 5 | **Consolidate sibling Suspense boundaries** — one boundary for regions that resolve together; separate boundaries only for genuinely slow + independent content | React 19.2 | <https://react.dev/reference/react/Suspense#revealing-content-together-at-once> |
| 6 | Parallelise server fetches with `Promise.all` to kill waterfalls; dedupe with React `cache()` | Next 16.1.6 | <https://nextjs.org/docs/app/guides/caching-without-cache-components#deduplicating-requests> |
| 7 | `manifest.ts` `background_color` must match the app's real CSS background; `theme_color` matched by a `<meta name="theme-color">` in the document head | Web App Manifest | <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/background_color> — *"It is recommended that the color value you specify for the `background_color` manifest member matches the `background-color` property value in your app's stylesheet."* |
| 8 | Service worker: **precache the real hashed JS/CSS of the app shell**, serve a cached shell for navigations, revalidate in the background | web.dev / MDN | <https://web.dev/articles/app-shell-model>, <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers> |
| 9 | Skeleton **delay-before-show** + **minimum-display-time** | UX research | see thresholds below |
| 10 | `prefers-reduced-motion` must disable the shimmer | MDN | <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion> |
| 11 | Reserve space: skeleton box === content box, so CLS ≈ 0 | web.dev | <https://web.dev/articles/optimize-cls> — *"reserve sufficient space in the viewport for it in advance (for example, using a placeholder or skeleton UI)"* |
| 12 | `next/dynamic` for interaction-only client components (no `ssr: false`) | Next 16.1.6 | <https://nextjs.org/docs/app/guides/lazy-loading> |

### Skeleton timing thresholds chosen

- **Delay before showing: 200 ms.** Below this, content that resolves quickly
  never shows a skeleton at all.
- **Minimum display once shown: 500 ms.** Prevents the blink.

Sources: NN/g, *Skeleton Screens 101* — <https://www.nngroup.com/articles/skeleton-screens/> — notes that skeletons used for very fast loads *"can be annoying because the quick flashing page can cause users to feel like they can't keep up."* NN/g's own coarse guidance is "under ~1 s needs no indicator; spinners for 2–10 s; skeletons for full-page loads under 10 s". The finer 200 ms / 500 ms pair is the widely-adopted delay+floor implementation of that principle (Carbon Design System loading pattern, <https://carbondesignsystem.com/patterns/loading-pattern/>; GitLab Pajamas skeleton loader, <https://design.gitlab.com/components/skeleton-loader>). 200 ms is also the point at which a transition stops reading as "instant".

## Techniques that turned out to be wrong / deprecated / not applicable

| Remembered technique | Actual status in Next 16.1.6 | Source |
| --- | --- | --- |
| `experimental.ppr: true` + `export const experimental_ppr = true` | **Removed in v16.0.0.** Partial Prerendering is no longer a flag of its own — it is the default *behavior* of **Cache Components** (`cacheComponents: true`). A codemod exists to strip `experimental_ppr`. | <https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config> (Version History), <https://nextjs.org/docs/app/getting-started/caching> |
| `cacheComponents: true` to get a static shell | Initially deferred as out of scope, then **prototyped end to end and rejected on evidence**. It builds after removing 7 route configs, the root layout's `headers()` read, two `usePathname()` reads and a `Math.random()` — and every route does prerender (`◐ Partial Prerender`). But it is **incompatible with this app's nonce-based CSP**: with no nonce, Next's own inline RSC scripts are blocked and the app never hydrates. `experimental.sri`, the documented hash-based alternative, emits zero `integrity` attributes under Turbopack and does nothing for inline scripts. Only `'unsafe-inline'` makes it run. Measured payoff was ~0 locally anyway (shell flush 42 ms vs 43 ms). Full working in DIAGNOSIS.md Phase 5. | <https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents>, <https://nextjs.org/docs/app/guides/content-security-policy> |
| `export const instant = true` to validate instant navigation | Exists in 16 but **"only works when `cacheComponents` is enabled"**, and is experimental (`level` only supports `'warning'`, dev-only). Not usable here. | <https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant> |
| `next/dynamic` with `ssr: false` to skip the slow bits | Works only *inside* Client Components — **"`ssr: false` is not allowed with `next/dynamic` in Server Components"**. Also explicitly forbidden by this task's constraints, and it would make the blank-screen symptom worse, not better. **Rejected.** | <https://nextjs.org/docs/app/guides/lazy-loading#skipping-ssr> |
| `after()` for deferring work | Real and stable, but nothing on the critical path here is post-response work. **Not applicable.** | <https://nextjs.org/docs/app/api-reference/functions/after> |
| "Next.js recommends a hand-rolled `public/sw.js`" | The PWA guide's `sw.js` example is **push-notification only**. For real offline/precaching it explicitly points at **Serwist**. | <https://nextjs.org/docs/app/guides/progressive-web-apps> — *"For full service-worker-based offline caching, one option is Serwist"* |
| `experimental.useOffline` / `useOffline()` hook | Exists in 16 as **experimental**, for connectivity-aware UI and retrying failed navigations. Not a precache mechanism, and experimental. **Rejected.** | <https://nextjs.org/docs/app/guides/progressive-web-apps> |
| `build-manifest.json` `pages['/_app']` holds the shared App Router chunks | **False for the App Router.** In this build `pages` contains only `/_app: []`. The shared entry chunks live in **`rootMainFiles`**. This is the bug in `scripts/post-build.js`. | verified directly against `.next/build-manifest.json` of this build |

## Open question from Phase 0 — now resolved by measurement

**Question:** does the CSP built in `proxy.ts` block Next.js's own inline RSC
flight-data scripts, since the nonce is set on the response header and on an
`x-nonce` request header but not on a request-side `Content-Security-Policy`?

**Answer: no.** Verified against the served HTML of `/auth/login`: every script
Next.js emits — the external chunks and the inline `self.__next_f.push(...)`
bootstrap — carries `nonce="YzY5MGM5MTMt…"`, matching the `script-src` nonce in
the response CSP header. Nothing is blocked. Recorded in DIAGNOSIS.md under
"What the evidence does not support".

This matters for the fix: because Next.js handles its own scripts, the *only*
consumer of `headers()` in the root layout is the hand-written theme-init
script, which is a fixed string and can be authorised by a **CSP hash** instead.

## Added during Phase 2 — a technique that had to be abandoned mid-implementation

**Removing `headers()` from the root layout to get a static shell.**

The reasoning in row 1/2 of the table above is sound and the change worked as
designed: swapping the theme script's per-request nonce for a CSP `sha256-`
hash let the root layout drop `headers()`, and **12 routes flipped from
`ƒ (Dynamic)` to `○ (Static)`** — `/auth/login`, `/auth/signup`, all of
`/legal/*`, `/offline`, `/_not-found`.

It then broke those pages completely, and the reason is structural rather than
a mistake in the implementation:

> Next.js stamps the per-request CSP nonce onto the inline RSC bootstrap
> scripts it generates itself. A statically prerendered page has no request, so
> it has no nonce — and the app's `script-src 'self' 'nonce-…'` then blocks
> Next's own scripts.

Measured directly, on `/auth/login` after the change:

```
[error] Executing inline script violates the following Content Security Policy
        directive 'script-src 'self' 'nonce-ODg0MGI4MDQt…' 'sha256-GHmofR…'
```

…repeated for every inline script on the page.

**A nonce-based CSP and static prerendering are mutually exclusive.** The
options are `'unsafe-inline'` (a real security regression), or a build-time
pipeline that hashes every inline script Next.js generates (not something the
framework exposes). Both are worse than a dynamic render, so the change was
reverted: `src/app/layout.tsx` reads `headers()` again, with a comment
recording why it must.

The one piece kept from the attempt is `src/lib/theme-init-script.ts`, which
holds the script text in one place so the layout and any test asserting on it
cannot drift.
