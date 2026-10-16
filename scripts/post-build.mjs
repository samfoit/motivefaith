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

/**
 * Where client chunks are emitted, relative to `.next/` and to `/_next/`.
 *
 * With `supportsImmutableAssets` (Next 16.3+, switched on by the Vercel
 * adapter) content-hashed chunks move under `static/immutable/`, and the
 * browser requests them there. Matching only `static/chunks/` precached none
 * of the route chunks in production, so an offline launch served the cached
 * dashboard and then failed to load its JS ("Failed to load chunk").
 */
const CHUNK_DIRS = ["static/chunks", "static/immutable/chunks"];

/** Read a JSON file, or return null if it isn't there. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Collect the hashed client assets the app needs to run with no network.
 *
 * Every JS and CSS chunk the build emitted, not just a route's entry chunks.
 * The shell documents (SHELL_DOCUMENTS in the worker) are served offline, and
 * a document served without its chunks is worse than not serving it: the user
 * gets "Failed to load chunk" instead of the offline page. Picking chunks per
 * route kept missing the ones loaded lazily through `next/dynamic` (the
 * dashboard's day/week/month views, the completion form, the camera), which
 * the client-reference manifest does not list, so opening any of them offline
 * failed. The whole set is a couple of megabytes of immutable, user-agnostic
 * code, which is cheaper than a precache that is quietly incomplete.
 */
function collectCriticalAssets() {
  const assets = new Set();

  const buildManifest = readJson(join(NEXT_DIR, "build-manifest.json"));
  for (const file of [
    ...(buildManifest?.rootMainFiles ?? []),
    ...(buildManifest?.polyfillFiles ?? []),
  ]) {
    assets.add("/_next/" + file);
  }

  for (const dir of CHUNK_DIRS) {
    const chunkDir = join(NEXT_DIR, dir);
    if (!existsSync(chunkDir)) continue;
    for (const file of readdirSync(chunkDir)) {
      if (file.endsWith(".js") || file.endsWith(".css")) {
        assets.add(`/_next/${dir}/${file}`);
      }
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
