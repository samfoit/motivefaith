import { test, expect } from "@playwright/test";
import { TEST_PASSWORD, uniqueEmail, uniqueUsername } from "./helpers/constants";
import { signUp } from "./helpers/auth";
import { createHabit } from "./helpers/habits";

// ---------------------------------------------------------------------------
// Rain Check E2E
// ---------------------------------------------------------------------------
// A rain check is a deliberate skip: it holds the streak, records an optional
// reason, and — unlike a completion — leaves the habit open to a real
// check-in later the same day.
// Requires a running local Supabase instance.
// ---------------------------------------------------------------------------

test.describe("Rain Check", () => {
  test("user can skip a day, keep the streak, and still check in after", async ({
    page,
  }) => {
    await signUp(page, {
      email: uniqueEmail("rain"),
      password: TEST_PASSWORD,
      name: "Rain Tester",
      username: uniqueUsername("rain"),
    });

    await createHabit(page, { title: "Rain Habit" });
    await expect(page.getByText("Rain Habit")).toBeVisible({ timeout: 5000 });

    // --- Open the check-in drawer ------------------------------------------
    await page
      .getByRole("button", { name: /^Show check-in options for Rain Habit$/ })
      .click();

    const rainCheck = page.getByRole("button", {
      name: /^Rain check for Rain Habit$/,
    });
    await expect(rainCheck).toBeVisible();

    // The fifth option must stay within the viewport — the card slides off the
    // drawer, so anything past the edge is unreachable rather than just clipped.
    const box = await rainCheck.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

    // --- Pick a reason and add a note --------------------------------------
    await rainCheck.click();
    await expect(page.getByRole("button", { name: "Take rain check" })).toBeVisible();

    await page.getByRole("button", { name: "Sick" }).click();
    await page
      .getByPlaceholder("Add a note (optional)")
      .fill("Flu — back tomorrow");
    await page.getByRole("button", { name: "Take rain check" }).click();

    // --- The day is settled, but the habit is not closed off ---------------
    const circle = page.getByRole("button", {
      name: /Rain Habit rain-checked today/,
    });
    await expect(circle).toBeVisible({ timeout: 5000 });
    await expect(circle).toBeEnabled();

    // A skip is never counted as a completion, so no streak is started.
    await expect(page.getByLabel("1-day streak")).toHaveCount(0);

    // --- Changing your mind still works ------------------------------------
    await circle.click();
    await expect(
      page.getByRole("button", { name: /Rain Habit completed/ }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("a rain check can only be moved to a day the habit is free", async ({
    page,
  }) => {
    await signUp(page, {
      email: uniqueEmail("move"),
      password: TEST_PASSWORD,
      name: "Move Tester",
      username: uniqueUsername("move"),
    });

    // Free up exactly one day — tomorrow — so the habit is still due today
    // and has precisely one day it can be moved onto.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowName = tomorrow.toLocaleDateString("en-GB", {
      weekday: "long",
    });

    await createHabit(page, {
      title: "Move Habit",
      frequency: "Custom",
      deselectDays: [tomorrowName],
    });
    await expect(page.getByText("Move Habit")).toBeVisible({ timeout: 5000 });

    await page
      .getByRole("button", { name: /^Show check-in options for Move Habit$/ })
      .click();
    await page
      .getByRole("button", { name: /^Rain check for Move Habit$/ })
      .click();

    // --- Choose to move rather than skip -----------------------------------
    await page.getByRole("radio", { name: "Move it to another day" }).click();

    // Only the free day is on offer, and picking "move" arms it — so the
    // primary button names it instead of saying "Take rain check".
    await expect(page.getByRole("radio", { name: /day$/ })).toHaveCount(1);
    await page.getByRole("button", { name: `Move to ${tomorrowName}` }).click();

    // --- The day is settled, and the card says where it went ---------------
    await expect(
      page.getByRole("button", { name: /Move Habit rain-checked today/ }),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(`Moved to ${tomorrowName}`)).toBeVisible();

    // Still not a completion.
    await expect(page.getByLabel("1-day streak")).toHaveCount(0);

    // --- And the promise is visible on the habit's own page ----------------
    await page.getByText("Move Habit").first().click();
    await expect(
      page.getByText(new RegExp(`Moved to ${tomorrowName}`)).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("a habit scheduled every day is offered no move at all", async ({
    page,
  }) => {
    await signUp(page, {
      email: uniqueEmail("daily"),
      password: TEST_PASSWORD,
      name: "Daily Tester",
      username: uniqueUsername("daily"),
    });

    await createHabit(page, { title: "Daily Habit" });
    await expect(page.getByText("Daily Habit")).toBeVisible({ timeout: 5000 });

    await page
      .getByRole("button", { name: /^Show check-in options for Daily Habit$/ })
      .click();
    await page
      .getByRole("button", { name: /^Rain check for Daily Habit$/ })
      .click();

    // Every day already has its own occurrence, so there is nowhere to move
    // to — the sheet offers a plain skip and nothing else.
    await expect(
      page.getByRole("button", { name: "Take rain check" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Move it to another day" }),
    ).toHaveCount(0);
  });
});
