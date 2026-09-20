import { chromium, devices } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH = process.env.AUTH_STATE ?? join(HERE, "auth.json");
const url = process.argv[2], label = process.argv[3] ?? "trace";
const viewCookie = process.argv[4];
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN });
const ctx = await b.newContext({ ...devices["Pixel 5"], storageState: AUTH, serviceWorkers: "block" });
if (viewCookie) await ctx.addCookies([{ name: "motive-dashboard-view", value: viewCookie, url: "http://localhost:3111" }]);
await ctx.addInitScript(() => {
  window.__marks = []; window.__cls = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
    .observe({ type: "layout-shift", buffered: true });
  // A skeleton counts as VISIBLE only if it is painted: in the DOM, and not
  // inside a .motive-skeleton-screen still within its delay window (opacity 0).
  const sample = () => {
    const n = [...document.querySelectorAll(".motive-skeleton")].filter((e) => {
      if (!e.isConnected) return false;
      let el = e;
      while (el) {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return false;
        if (parseFloat(s.opacity) < 0.05) return false;
        el = el.parentElement;
      }
      return e.getBoundingClientRect().width > 0;
    }).length;
    const last = window.__marks[window.__marks.length - 1];
    if (!last || last.n !== n) window.__marks.push({ t: performance.now(), n });
  };
  // Sample from document_start, NOT from DOMContentLoaded: for a streamed
  // response DOMContentLoaded fires only after the whole stream completes, so
  // waiting for it misses the entire period the Suspense fallback is on screen.
  setInterval(sample, 25);
  const startObserver = () => {
    if (!document.body) return requestAnimationFrame(startObserver);
    new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, attributes: true });
  };
  startObserver();
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150,
  downloadThroughput: (1.6*1024*1024)/8, uploadThroughput: (750*1024)/8 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(5000);
const { marks, cls } = await page.evaluate(() => ({ marks: window.__marks ?? [], cls: window.__cls }));
console.log(`\n${label}${viewCookie ? " [view="+viewCookie+"]" : ""}   CLS=${cls.toFixed(4)}`);
let flashes = 0, shown = 0;
for (let i = 0; i < marks.length; i++) {
  const m = marks[i], next = marks[i+1];
  const dur = next ? next.t - m.t : null;
  if (m.n > 0) { shown++; if (dur !== null && dur < 500) flashes++; }
  if (m.n > 0) console.log(`  visible from ${m.t.toFixed(0)}ms for ${dur===null?"—":dur.toFixed(0)+"ms"}  (${m.n} blocks)${dur!==null&&dur<500?"   <-- FLASH":""}`);
}
if (!shown) console.log("  no skeleton ever became visible");
console.log(`  => ${shown} visible skeleton state(s), ${flashes} shorter than 500ms`);
await b.close();
