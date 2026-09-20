import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Regression tests for the service-worker build step.
 *
 * Two bugs made the previous version silently produce a worker that precached
 * nothing and never busted its cache (DIAGNOSIS.md R2):
 *
 *  1. it read the Pages Router manifest keys, which are always empty in an
 *     App Router build, so no assets were ever injected;
 *  2. it rewrote the tracked source file in place with `String.replace`, which
 *     substituted the first match — a mention of the token in a comment — and
 *     left the real placeholder frozen at whatever the first build produced.
 *
 * Both are cheap to assert and expensive to notice in production, so they are
 * pinned here.
 */
function runPostBuild(): { dir: string; sw: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "postbuild-"));

  // Minimal fixture of the parts of `.next` the script reads.
  mkdirSync(join(dir, ".next", "static", "chunks"), { recursive: true });
  mkdirSync(join(dir, ".next", "server", "app", "main", "dashboard"), {
    recursive: true,
  });
  mkdirSync(join(dir, "public"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src", "sw"), { recursive: true });

  writeFileSync(join(dir, ".next", "BUILD_ID"), "test-build-id-123\n");
  writeFileSync(
    join(dir, ".next", "build-manifest.json"),
    JSON.stringify({
      // Exactly the shape a real App Router build produces: the Pages Router
      // keys are present but empty, and the real chunks are in rootMainFiles.
      pages: { "/_app": [] },
      rootMainFiles: ["static/chunks/root-abc.js"],
      polyfillFiles: ["static/chunks/polyfill-xyz.js"],
    }),
  );
  writeFileSync(
    join(dir, ".next", "server", "app", "main", "dashboard", "page_client-reference-manifest.js"),
    'globalThis.X={"m":"static/chunks/dashboard-def.js","n":"static/chunks/styles-ghi.css"};',
  );
  writeFileSync(join(dir, ".next", "static", "chunks", "styles-ghi.css"), "body{}");

  cpSync(join(REPO, "src", "sw", "service-worker.js"), join(dir, "src", "sw", "service-worker.js"));
  cpSync(join(REPO, "scripts", "post-build.mjs"), join(dir, "scripts", "post-build.mjs"));

  const stdout = execFileSync("node", ["scripts/post-build.mjs"], {
    cwd: dir,
    encoding: "utf8",
  });
  return { dir, sw: readFileSync(join(dir, "public", "sw.js"), "utf8"), stdout };
}

describe("post-build service worker generation", () => {
  let out: ReturnType<typeof runPostBuild>;
  beforeAll(() => {
    out = runPostBuild();
  });

  it("injects the current build id as the cache version", () => {
    expect(out.sw).toContain('var CACHE_VERSION = "test-build-id-123"');
  });

  it("leaves no unsubstituted placeholders", () => {
    expect(out.sw).not.toContain("__MOTIVE_BUILD_ID__");
    expect(out.sw).not.toContain('"__MOTIVE_CRITICAL_ASSETS__"');
  });

  it("precaches the shared entry chunks from rootMainFiles, not the empty Pages Router key", () => {
    expect(out.sw).toContain("/_next/static/chunks/root-abc.js");
    expect(out.sw).toContain("/_next/static/chunks/polyfill-xyz.js");
  });

  it("precaches the start_url route's own chunks", () => {
    expect(out.sw).toContain("/_next/static/chunks/dashboard-def.js");
  });

  it("precaches the render-blocking stylesheet", () => {
    // The one asset that actually gates first paint.
    expect(out.sw).toContain("/_next/static/chunks/styles-ghi.css");
    expect(out.stdout).toMatch(/1 css/);
  });

  it("does not modify its own source file (is re-runnable)", () => {
    const src = readFileSync(join(out.dir, "src", "sw", "service-worker.js"), "utf8");
    expect(src).toContain("__MOTIVE_BUILD_ID__");
    expect(src).toContain('"__MOTIVE_CRITICAL_ASSETS__"');

    // Running again must produce identical output rather than degrading.
    const again = execFileSync("node", ["scripts/post-build.mjs"], {
      cwd: out.dir,
      encoding: "utf8",
    });
    expect(readFileSync(join(out.dir, "public", "sw.js"), "utf8")).toBe(out.sw);
    expect(again).toMatch(/BUILD_ID=test-build-id-123/);
  });
});
