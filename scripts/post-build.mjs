// @ts-check
/**
 * Post-build script: generates `public/sw.js` from `src/sw/service-worker.js`,
 * substituting the build id and the app shell's hashed asset paths so the
 * service worker can precache everything needed to paint the shell.
 *
 * This reads from the source file and WRITES a separate generated file, so it
 * is idempotent. (The previous version rewrote the tracked `public/sw.js` in
 * place, which consumed its own placeholders on the first run and left the
 * cache version permanently frozen at whatever the first build produced.)
 *
 * Usage: node scripts/post-build.js
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, "..");
const SW_SRC = join(ROOT, "src", "sw", "service-worker.js");
const SW_OUT = join(ROOT, "public", "sw.js");
const NEXT_DIR = join(ROOT, ".next");

/** Read a JSON file, or return null if it isn't there. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Collect the hashed client assets that must be present for the app shell to
 * paint: the global stylesheet (render-blocking, so the single most valuable
 * thing to precache) and the shared entry chunks every route loads.
 *
 * The App Router records the shared entry chunks in `build-manifest.json`
 * under `rootMainFiles`. The old implementation looked for the Pages Router
 * keys `pages['/_app']` and `pages['/main/dashboard']`, which are always
 * empty here — hence the "No critical assets found" every build printed.
 */
function collectCriticalAssets() {
  const assets = new Set();

  const buildManifest = readJson(join(NEXT_DIR, "build-manifest.json"));
  for (const file of buildManifest?.rootMainFiles ?? []) {
    assets.add("/_next/" + file);
  }
  for (const file of buildManifest?.polyfillFiles ?? []) {
    assets.add("/_next/" + file);
  }

  // Per-route chunks for the shell-bearing routes. `/main/dashboard` is the
  // PWA start_url, so its chunks are what an installed-app launch needs.
  //
  // Turbopack does not emit `app-build-manifest.json`, so fall back to the
  // per-route client-reference manifest, which names every client chunk the
  // route pulls in. Reading the paths out by regex is deliberate: the file is
  // executable JS that assigns onto `globalThis`, not JSON we can parse.
  for (const route of ["main/dashboard", "offline"]) {
    const refManifest = join(
      NEXT_DIR, "server", "app", route, "page_client-reference-manifest.js",
    );
    if (!existsSync(refManifest)) continue;
    const src = readFileSync(refManifest, "utf8");
    for (const [chunk] of src.matchAll(/static\/chunks\/[A-Za-z0-9._-]+\.(?:js|css)/g)) {
      assets.add("/_next/" + chunk);
    }
  }

  // Stylesheets are render-blocking, so precaching them is what actually moves
  // first paint. Turbopack does not always list them in the manifests above,
  // so sweep the emitted CSS directly — there are only a handful.
  const cssDir = join(NEXT_DIR, "static", "chunks");
  if (existsSync(cssDir)) {
    for (const file of readdirSync(cssDir)) {
      if (file.endsWith(".css")) assets.add("/_next/static/chunks/" + file);
    }
  }

  return [...assets];
}

if (!existsSync(SW_SRC)) {
  console.error(`post-build: service worker source not found at ${SW_SRC}`);
  process.exit(1);
}

const buildId = readFileSync(join(NEXT_DIR, "BUILD_ID"), "utf8").trim();
const criticalAssets = collectCriticalAssets();

let sw = readFileSync(SW_SRC, "utf8");

// replaceAll, and against tokens that appear exactly once as a string literal,
// so a mention in a comment can never swallow the substitution.
sw = sw.replaceAll("__MOTIVE_BUILD_ID__", buildId);
sw = sw.replaceAll(
  '"__MOTIVE_CRITICAL_ASSETS__"',
  JSON.stringify(JSON.stringify(criticalAssets)),
);

for (const token of ["__MOTIVE_BUILD_ID__", '"__MOTIVE_CRITICAL_ASSETS__"']) {
  if (sw.includes(token)) {
    console.error(`post-build: placeholder ${token} was left unsubstituted`);
    process.exit(1);
  }
}

writeFileSync(SW_OUT, sw);

console.log(
  `post-build: wrote public/sw.js (BUILD_ID=${buildId}, ${criticalAssets.length} precached shell assets, ` +
    `${criticalAssets.filter((a) => a.endsWith(".css")).length} css / ` +
    `${criticalAssets.filter((a) => a.endsWith(".js")).length} js)`,
);

if (criticalAssets.length === 0) {
  console.error("post-build: no critical assets found — the shell will not be precached");
  process.exit(1);
}
