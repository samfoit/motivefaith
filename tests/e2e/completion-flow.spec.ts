import { test, expect } from "@playwright/test";
import { TEST_PASSWORD, uniqueEmail, uniqueUsername } from "./helpers/constants";
import { signUp } from "./helpers/auth";
import { createHabit } from "./helpers/habits";

// ---------------------------------------------------------------------------
// Completion Flow E2E
// ---------------------------------------------------------------------------
// This test signs up a user, creates a habit, logs a quick completion,
// and verifies the dashboard updates.
// Requires a running local Supabase instance.
// ---------------------------------------------------------------------------

test.describe("Completion Flow", () => {
  test("user can sign up, create a habit, and complete it", async ({
    page,
  }) => {
    // -----------------------------------------------------------------------
    // Step 1: Sign up
    // -----------------------------------------------------------------------
    await signUp(page, {
      email: uniqueEmail(),
      password: TEST_PASSWORD,
      name: "Test User",
      username: uniqueUsername(),
    });

    // -----------------------------------------------------------------------
    // Step 2: Create a habit
    // -----------------------------------------------------------------------
    await createHabit(page, { title: "Test Morning Run" });

    // -----------------------------------------------------------------------
    // Step 3: Verify habit appears on dashboard
    // -----------------------------------------------------------------------
    await expect(page.getByText("Test Morning Run")).toBeVisible({
      timeout: 5000,
    });

    // -----------------------------------------------------------------------
    // Step 4: Complete the habit (quick complete)
    // -----------------------------------------------------------------------
    const completeButton = page.getByRole("button", {
      name: /complete test morning run/i,
    });
    await completeButton.click();

    // Verify the button shows completed state (disabled)
    await expect(
      page.getByRole("button", { name: /test morning run completed/i }),
    ).toBeVisible({ timeout: 5000 });

    // Verify progress bar updates
    await expect(page.getByText(/1\//)).toBeVisible({ timeout: 3000 });
  });
});
