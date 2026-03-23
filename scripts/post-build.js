// @ts-check
/**
 * Post-build script: injects BUILD_ID and critical static asset paths into
 * the service worker so they are precached on install.
 *
 * Usage: node scripts/post-build.js
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const SW_PATH = join(__dirname, "..", "public", "sw.js");
const BUILD_ID_PATH = join(__dirname, "..", ".next", "BUILD_ID");
const MANIFEST_PATH = join(__dirname, "..", ".next", "build-manifest.json");

let sw = readFileSync(SW_PATH, "utf8");

// 1. Replace __BUILD_ID__
const buildId = readFileSync(BUILD_ID_PATH, "utf8").trim();
sw = sw.replace("__BUILD_ID__", buildId);

// 2. Collect critical static assets from the build manifest
const criticalAssets = [];
try {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const pages = manifest.pages || {};

  // Root layout chunks are shared across all pages
  const rootChunks = pages["/_app"] || [];
  // Main dashboard is the most-visited authenticated page
  const dashboardChunks = pages["/main/dashboard"] || [];

  const seen = new Set();
  for (const chunk of [...rootChunks, ...dashboardChunks]) {
    // Build manifest paths are relative (e.g., "static/chunks/main-abc.js")
    const asset = "/_next/" + chunk;
    if (!seen.has(asset)) {
      seen.add(asset);
      criticalAssets.push(asset);
    }
  }
} catch (e) {
  // build-manifest.json might not exist in some CI setups; skip gracefully
  console.warn("Could not read build-manifest.json:", e.message);
}

if (criticalAssets.length > 0) {
  sw = sw.replace("__CRITICAL_ASSETS__", JSON.stringify(criticalAssets));
  console.log(
    `Injected ${criticalAssets.length} critical assets into SW precache.`,
  );
} else {
  console.log("No critical assets found; SW precache unchanged.");
}

writeFileSync(SW_PATH, sw);
console.log(`SW updated with BUILD_ID=${buildId}`);
