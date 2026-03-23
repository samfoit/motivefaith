import { test, expect } from "@playwright/test";
import { TEST_EMAIL, TEST_PASSWORD } from "./helpers/constants";
import { logIn } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Offline Completion E2E
// ---------------------------------------------------------------------------
// This test goes offline, logs a quick completion, verifies it appears in the
// UI optimistically, then goes back online and verifies the sync succeeded.
// Requires a running local Supabase instance with a logged-in user and habit.
// ---------------------------------------------------------------------------

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
    // Step 4: Go back online
    // -----------------------------------------------------------------------
    await context.setOffline(false);

    // Wait for background sync to process
    await page.waitForTimeout(3000);

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
