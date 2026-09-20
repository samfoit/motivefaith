/** Log in as the seeded local dev user and save the session storage state. */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH = process.env.AUTH_STATE ?? join(HERE, "auth.json");

const BASE = process.argv[2] ?? "http://localhost:3111";
const OUT = process.argv[3] ?? AUTH;

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();

await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
await page.getByLabel(/email/i).fill("alice@test.com");
await page.getByLabel(/password/i).first().fill("password123");
await page.getByRole("button", { name: /log in|sign in/i }).click();

try {
  await page.waitForURL(/\/main\/dashboard/, { timeout: 20000 });
  console.log("logged in ->", page.url());
} catch {
  console.log("login did not reach dashboard; at", page.url());
  console.log(await page.locator("body").innerText());
  process.exit(1);
}

await ctx.storageState({ path: OUT });
console.log("saved", OUT);
await browser.close();
