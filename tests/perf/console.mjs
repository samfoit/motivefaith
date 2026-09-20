import { chromium, devices } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH = process.env.AUTH_STATE ?? join(HERE, "auth.json");
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN });
const ctx = await b.newContext({ ...devices["Pixel 5"], storageState: AUTH, serviceWorkers: "block" });
const page = await ctx.newPage();
const msgs = [];
page.on("console", (m) => msgs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => msgs.push(`[pageerror] ${e.message.slice(0, 300)}`));
for (const p of process.argv.slice(2)) {
  await page.goto(`http://localhost:3111${p}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);
}
console.log(msgs.length ? msgs.join("\n") : "(no console output)");
const hyd = msgs.filter(m => /hydrat|did not match|Text content does not match/i.test(m));
console.log("\nhydration-related:", hyd.length ? hyd.join("\n") : "none");
await b.close();
