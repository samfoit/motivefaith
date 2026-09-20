/**
 * Repeat-visit / installed-PWA measurement.
 * Load once so the SW installs and precaches, then measure a SECOND load in
 * the same (persistent) profile with the SW controlling.
 */
import { chromium, devices } from "playwright";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH = process.env.AUTH_STATE ?? join(HERE, "auth.json");

const label = process.argv[2], url = process.argv[3];
const standalone = process.argv.includes("--standalone");
const profile = mkdtempSync(join(tmpdir(), "swprof-"));

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN,
  ...devices["Pixel 5"],
  serviceWorkers: "allow",
  args: standalone ? ["--app=" + url] : [],
});

// Seed the auth cookies.
const state = JSON.parse(await (await import("fs/promises")).readFile(AUTH, "utf8"));
await ctx.addCookies(state.cookies);

const VITALS = `
window.__v={cls:0,lcp:0,fcp:0,tbt:0};
new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.name==='first-contentful-paint')window.__v.fcp=e.startTime}).observe({type:'paint',buffered:true});
new PerformanceObserver(l=>{const es=l.getEntries();window.__v.lcp=es[es.length-1].startTime}).observe({type:'largest-contentful-paint',buffered:true});
new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__v.cls+=e.value}).observe({type:'layout-shift',buffered:true});
new PerformanceObserver(l=>{for(const e of l.getEntries())window.__v.tbt+=Math.max(0,e.duration-50)}).observe({type:'longtask',buffered:true});
`;
await ctx.addInitScript(VITALS);

const warm = ctx.pages()[0] ?? (await ctx.newPage());
await warm.goto(url, { waitUntil: "load", timeout: 60000 });
await warm.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => {});
await warm.waitForTimeout(4000);

const cacheInfo = await warm.evaluate(async () => {
  const names = await caches.keys();
  const out = {};
  for (const n of names) out[n] = (await caches.open(n)).then;
  const res = {};
  for (const n of names) {
    const urls = (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname);
    res[n] = { total: urls.length, js: urls.filter(u=>u.endsWith(".js")).length, css: urls.filter(u=>u.endsWith(".css")).length };
  }
  return { controlled: !!navigator.serviceWorker.controller, caches: res };
});
console.log("SW controlled:", cacheInfo.controlled, JSON.stringify(cacheInfo.caches));

// Second visit, throttled, SW active.
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline:false, latency:150,
  downloadThroughput:(1.6*1024*1024)/8, uploadThroughput:(750*1024)/8 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(4000);
const v = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const res = performance.getEntriesByType("resource");
  return { ...window.__v, ttfb: nav?.responseStart ?? 0, load: nav?.loadEventEnd ?? 0,
    fromSW: res.filter(r => r.deliveryType === "cache" || r.transferSize === 0).length, resources: res.length };
});
console.log(`\n${label} (repeat visit, SW active)`);
for (const k of ["fcp","lcp","ttfb","cls","tbt","load"]) console.log(`  ${k}: ${typeof v[k]==="number"?v[k].toFixed(k==="cls"?4:0):v[k]}`);
console.log(`  resources served without network transfer: ${v.fromSW}/${v.resources}`);
await ctx.close();
