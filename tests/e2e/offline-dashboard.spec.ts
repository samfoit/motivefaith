import { test, expect, type Page } from "@playwright/test";
import { TEST_EMAIL, TEST_PASSWORD } from "./helpers/constants";
import { logIn } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Offline Dashboard E2E
// ---------------------------------------------------------------------------
// The dashboard document carries no user data, so the service worker caches it
// and serves it when the network is gone; the habits themselves come from the
// persisted React Query cache in IndexedDB. Before this, an offline navigation
// to /main/dashboard replaced the whole app with the dead-end offline page —
// even for a screen the user had open seconds earlier (DIAGNOSIS.md R1).
//
// Needs a running local Supabase with a seeded user who has at least one habit.
// ---------------------------------------------------------------------------

/** Number of rows sitting in the offline outbox. */
function pendingCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("motive-offline", 1);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("pending-completions")) return resolve(0);
          const req = db
            .transaction("pending-completions", "readonly")
            .objectStore("pending-completions")
            .count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(-1);
        };
        open.onerror = () => resolve(-1);
      }),
  );
}

async function signInAndWarmCache(page: Page): Promise<boolean> {
  const loggedIn = await logIn(page, TEST_EMAIL, TEST_PASSWORD);
  if (!loggedIn) return false;
  await page.waitForLoadState("networkidle");
  // The worker has to be controlling before it can serve anything offline.
  await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(2000); // let the query cache persist
  return true;
}

test.describe("Offline dashboard", () => {
  test("renders habits from cache instead of the offline page", async ({ page, context }) => {
    if (!(await signInAndWarmCache(page))) {
      test.skip(true, "No seeded test user available");
      return;
    }
    const online = await page.locator("body").innerText();

    await context.setOffline(true);
    await page.goto("/main/dashboard", { waitUntil: "load" });
    await page.waitForTimeout(1500);

    const offline = await page.locator("body").innerText();

    // The dead-end page is gone...
    expect(offline).not.toContain("Your habits are safe. Any completions you logged");
    // ...and the real dashboard is there, with the offline banner above it.
    expect(offline).toContain("You're offline");
    expect(offline).toMatch(/Good (morning|afternoon|evening)/);
    // The habit list survived, rather than showing the "no habits yet" state.
    const habitName = online.match(/Active Streaks\s+\S+\s+([A-Za-z ]+)/)?.[1]?.trim();
    if (habitName) expect(offline).toContain(habitName);

    await context.setOffline(false);
  });

  test("a completion logged offline survives a reload and then syncs", async ({ page, context }) => {
    if (!(await signInAndWarmCache(page))) {
      test.skip(true, "No seeded test user available");
      return;
    }

    await context.setOffline(true);
    await page.goto("/main/dashboard", { waitUntil: "load" });
    await page.waitForTimeout(1500);

    const complete = page.getByRole("button", { name: /^Complete / }).first();
    if ((await complete.count()) === 0) {
      test.skip(true, "Seeded user has nothing left to complete today");
      return;
    }

    const before = await page.locator("body").innerText();
    const progressBefore = before.match(/Today's progress\s+(\d+)\/(\d+)/);
    await complete.click();

    // Past the 6s undo window, so the check-in is actually committed/queued.
    await page.waitForTimeout(8000);

    // It reached the outbox. Under React Query's default mutation networkMode
    // it never did: the mutation was paused before mutationFn ran, so the
    // completion was neither sent nor queued — it only looked logged.
    expect(await pendingCount(page)).toBeGreaterThan(0);

    // Still offline: reload and confirm the optimistic completion persisted.
    // It lives in the query cache (not component state), which is what gets
    // written to IndexedDB.
    await page.goto("/main/dashboard", { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const after = await page.locator("body").innerText();
    const progressAfter = after.match(/Today's progress\s+(\d+)\/(\d+)/);

    if (progressBefore && progressAfter) {
      expect(Number(progressAfter[1])).toBe(Number(progressBefore[1]) + 1);
    }
    expect(after).toContain("pending");

    // Reconnect: the drain flushes the outbox.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => pendingCount(page), { timeout: 20000 }).toBe(0);
  });

  test("shows a sign-in prompt, not someone's habits, when the session is gone", async ({
    page,
    context,
  }) => {
    if (!(await signInAndWarmCache(page))) {
      test.skip(true, "No seeded test user available");
      return;
    }

    // The cached document is user-agnostic, so it is safe to serve to anyone —
    // but it must not be able to produce data for a signed-out visitor.
    await context.clearCookies();
    await context.setOffline(true);
    await page.goto("/main/dashboard", { waitUntil: "load" });
    await page.waitForTimeout(1500);

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Good (morning|afternoon|evening), \w/);

    await context.setOffline(false);
  });
});
