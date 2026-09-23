import { test, expect, type Page } from "@playwright/test";
import { TEST_EMAIL, TEST_PASSWORD } from "./helpers/constants";
import { logIn } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Offline Completion E2E
// ---------------------------------------------------------------------------
// Goes offline, logs a quick completion, and verifies it is actually QUEUED —
// not merely shown as done — then reconnects and verifies it syncs.
//
// The optimistic-UI assertion alone used to be the whole test, and it passed
// while the feature was broken: React Query's default mutation networkMode
// ("online") pauses a mutation *before* calling mutationFn when offline, and
// every queueing path lives inside mutationFn. So nothing reached IndexedDB
// and the completion was silently lost on reload, while the dashboard's own
// optimistic state still showed the habit as complete. Asserting on the queue
// is what makes this test able to fail.
//
// Requires a running local Supabase instance with a logged-in user and habit.
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

test.describe("Offline Completion", () => {
  // This test requires an authenticated session with at least one habit.
  // In CI, this would be set up via Supabase seeding before the test suite.

  test("optimistic completion persists offline and syncs when back online", async ({
    page,
    context,
  }) => {
    // -----------------------------------------------------------------------
    // Setup: Login and navigate to dashboard
    // -----------------------------------------------------------------------
    const loggedIn = await logIn(page, TEST_EMAIL, TEST_PASSWORD);
    if (!loggedIn) {
      test.skip(true, "No seeded test user available");
      return;
    }

    await page.waitForLoadState("networkidle");

    // Verify at least one habit card exists
    const habitCards = page.getByRole("button", { name: /^Complete /i });
    const count = await habitCards.count();
    if (count === 0) {
      test.skip(true, "No habits found for test user");
      return;
    }

    // Get the first habit's completion button
    const firstCompleteBtn = habitCards.first();
    const habitName =
      (await firstCompleteBtn.getAttribute("aria-label")) ?? "";

    // -----------------------------------------------------------------------
    // Step 1: Go offline
    // -----------------------------------------------------------------------
    await context.setOffline(true);

    // -----------------------------------------------------------------------
    // Step 2: Tap complete on the first habit
    // -----------------------------------------------------------------------
    await firstCompleteBtn.click();

    // -----------------------------------------------------------------------
    // Step 3: Verify optimistic update shows completion in UI
    // -----------------------------------------------------------------------
    // The button should now show "completed" state
    const completedName = habitName.replace("Complete ", "") + " completed";
    await expect(
      page.getByRole("button", { name: new RegExp(completedName, "i") }),
    ).toBeVisible({ timeout: 3000 });

    // -----------------------------------------------------------------------
    // Step 3b: It must actually be in the outbox, not just on screen
    // -----------------------------------------------------------------------
    // The check-in is held for a 6s undo window before it is sent or queued.
    await page.waitForTimeout(8000);
    expect(await pendingCount(page)).toBeGreaterThan(0);

    // -----------------------------------------------------------------------
    // Step 4: Go back online
    // -----------------------------------------------------------------------
    await context.setOffline(false);
    // The drain listens for this; dispatching it avoids depending on how
    // quickly the browser notices connectivity came back.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // The queue must empty — on every browser, including those without
    // Background Sync (all of Safari/iOS), where nothing used to drain it.
    await expect.poll(() => pendingCount(page), { timeout: 20000 }).toBe(0);

    // -----------------------------------------------------------------------
    // Step 5: Refresh and verify the completion persisted
    // -----------------------------------------------------------------------
    await page.reload();
    await page.waitForLoadState("networkidle");

    // The habit should still show as completed after reload
    await expect(
      page.getByRole("button", { name: new RegExp(completedName, "i") }),
    ).toBeVisible({ timeout: 5000 });
  });
});
