/**
 * Web-vitals measurement under fixed throttling.
 *
 *   node measure.mjs <label> <url> [--auth=<storageStatePath>] [--sw]
 *
 * Emulates a mid-tier mobile device: Slow 4G + 4x CPU slowdown, Pixel-5-ish
 * viewport. Collects FCP, LCP, TTFB, CLS, TBT and initial JS transfer/parse.
 */
import { chromium, devices } from "playwright";
import { writeFileSync } from "fs";

const [, , label, url, ...rest] = process.argv;
const authPath = rest.find((a) => a.startsWith("--auth="))?.slice(7);
const keepSW = rest.includes("--sw");
const RUNS = Number(rest.find((a) => a.startsWith("--runs="))?.slice(7) ?? 5);

// Slow 4G, per Lighthouse's mobile throttling profile.
const NET = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};
const CPU_RATE = 4;

const VITALS = `
window.__v = { cls: 0, lcp: 0, fcp: 0, tbt: 0, longTasks: 0 };
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__v.fcp = e.startTime;
}).observe({ type: 'paint', buffered: true });
new PerformanceObserver((l) => {
  const es = l.getEntries();
  window.__v.lcp = es[es.length - 1].startTime;
}).observe({ type: 'largest-contentful-paint', buffered: true });
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value;
}).observe({ type: 'layout-shift', buffered: true });
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) {
    window.__v.longTasks++;
    window.__v.tbt += Math.max(0, e.duration - 50);
  }
}).observe({ type: 'longtask', buffered: true });
`;

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const results = [];

for (let run = 0; run < RUNS; run++) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  const ctx = await browser.newContext({
    ...devices["Pixel 5"],
    ...(authPath ? { storageState: authPath } : {}),
    serviceWorkers: keepSW ? "allow" : "block",
  });
  await ctx.addInitScript(VITALS);

  // Count bytes on the wire, by type.
  let jsBytes = 0, cssBytes = 0, docBytes = 0, otherBytes = 0, jsReqs = 0;
  ctx.on("response", async (res) => {
    try {
      const h = await res.allHeaders();
      const len = Number(h["content-length"] ?? 0);
      const ct = (h["content-type"] ?? "").split(";")[0];
      if (ct.includes("javascript")) { jsBytes += len; jsReqs++; }
      else if (ct.includes("css")) cssBytes += len;
      else if (ct.includes("html")) docBytes += len;
      else otherBytes += len;
    } catch { /* response body gone */ }
  });

  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NET);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  // Let LCP/CLS settle.
  await page.waitForTimeout(4000);

  const v = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      ...window.__v,
      ttfb: nav ? nav.responseStart : 0,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : 0,
      load: nav ? nav.loadEventEnd : 0,
      // Bytes actually decoded by the browser, incl. compressed responses.
      jsDecoded: performance
        .getEntriesByType("resource")
        .filter((r) => r.initiatorType === "script")
        .reduce((s, r) => s + (r.decodedBodySize || 0), 0),
      jsTransfer: performance
        .getEntriesByType("resource")
        .filter((r) => r.initiatorType === "script")
        .reduce((s, r) => s + (r.transferSize || 0), 0),
      // Critical-path race: the render-blocking stylesheet versus anything
      // preloaded ahead of it. FCP cannot happen before the stylesheet's
      // responseEnd, so comparing these attributes the wait.
      critical: performance
        .getEntriesByType("resource")
        .filter((r) => /\.css($|\?)/.test(r.name) || /\.woff2?($|\?)/.test(r.name))
        .map((r) => ({
          kind: /\.css($|\?)/.test(r.name) ? "css" : "font",
          name: r.name.split("/").pop(),
          start: Math.round(r.startTime),
          responseStart: Math.round(r.responseStart),
          end: Math.round(r.responseEnd),
          transfer: r.transferSize,
          renderBlocking: r.renderBlockingStatus,
        }))
        .sort((a, b) => a.start - b.start),
    };
  });

  results.push({ ...v, wallMs: Date.now() - t0, jsBytes, cssBytes, docBytes, otherBytes, jsReqs });
  await browser.close();
}

const keys = ["fcp", "lcp", "ttfb", "cls", "tbt", "load", "jsDecoded", "jsTransfer", "jsReqs", "longTasks"];
const out = { label, url, runs: RUNS, throttle: "Slow 4G (1.6Mbps/150ms RTT) + 4x CPU, Pixel 5" };
for (const k of keys) out[k] = Number(median(results.map((r) => r[k])).toFixed(k === "cls" ? 4 : 1));

// Attribution for the first run: what the browser was waiting on before FCP.
const first = results[0];
if (first?.critical?.length) {
  console.log(`\ncritical-path resources (run 1), FCP=${Math.round(first.fcp)}ms:`);
  console.log("  kind  start   end  transfer  blocking  file");
  for (const r of first.critical) {
    console.log(
      `  ${r.kind.padEnd(5)} ${String(r.start).padStart(5)} ${String(r.end).padStart(5)}` +
        `  ${String(Math.round((r.transfer || 0) / 1024) + "KB").padStart(7)}` +
        `  ${String(r.renderBlocking ?? "-").padStart(8)}  ${r.name}`,
    );
  }
  const css = first.critical.find((r) => r.kind === "css");
  const fonts = first.critical.filter((r) => r.kind === "font");
  if (css) {
    const fontBytesBeforeCss = fonts
      .filter((f) => f.start < css.end)
      .reduce((s, f) => s + (f.transfer || 0), 0);
    console.log(
      `\n  stylesheet finished at ${css.end}ms (FCP ${Math.round(first.fcp)}ms);` +
        ` ${Math.round(fontBytesBeforeCss / 1024)}KB of font bytes were in flight alongside it`,
    );
  }
}

console.log(JSON.stringify(out, null, 2));
writeFileSync(`${label}.json`, JSON.stringify({ summary: out, runs: results }, null, 2));
