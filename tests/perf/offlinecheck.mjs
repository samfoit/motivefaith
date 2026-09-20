import { chromium, devices } from "playwright";
import { mkdtempSync } from "fs"; import { readFile } from "fs/promises";
import { tmpdir } from "os"; import { join } from "path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH = process.env.AUTH_STATE ?? join(HERE, "auth.json");
const base = process.argv[2], auth = process.argv[3] ?? AUTH;
const standalone = process.argv.includes("--standalone");
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),"off-")), {
  executablePath: process.env.CHROME_BIN, ...devices["Pixel 5"], serviceWorkers: "allow",
  args: standalone ? [`--app=${base}/main/dashboard`] : [] });
ctx.addCookies(JSON.parse(await readFile(auth,"utf8")).cookies);
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(base + "/main/dashboard", { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(()=>!!navigator.serviceWorker?.controller,null,{timeout:30000}).catch(()=>{});
await page.waitForTimeout(3000);
const cache = await page.evaluate(async () => {
  const n = (await caches.keys())[0];
  const urls = (await (await caches.open(n)).keys()).map(r=>new URL(r.url).pathname);
  return { name: n, css: urls.filter(u=>u.endsWith(".css")), js: urls.filter(u=>u.endsWith(".js")).length,
           routes: urls.filter(u=>!u.startsWith("/_next")) };
});
console.log(`${standalone?"[installed PWA] ":""}cache ${cache.name}`);
console.log(`  css precached: ${cache.css.length} ${JSON.stringify(cache.css)}`);
console.log(`  js precached : ${cache.js}`);
console.log(`  routes       : ${JSON.stringify(cache.routes)}`);
await ctx.setOffline(true);
for (const path of ["/main/dashboard", "/"]) {
  const r = await page.goto(base + path, { waitUntil: "load" }).catch(e=>({err:e.message.split("\n")[0]}));
  await page.waitForTimeout(600);
  const t = await page.evaluate(()=>document.body.innerText.replace(/\s+/g," ").trim().slice(0,80)).catch(()=> "(none)");
  console.log(`  OFFLINE ${path} -> ${r?.status?.() ?? r?.err} :: ${JSON.stringify(t)}`);
}
await ctx.setOffline(false);
await ctx.close();
