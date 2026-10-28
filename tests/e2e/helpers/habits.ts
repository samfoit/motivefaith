import type { Page } from "@playwright/test";

interface HabitOptions {
  title: string;
  /**
   * The Repeat menu's label for the schedule ("Weekdays", "Custom"). Every
   * day is the default and needs no choice.
   */
  frequency?: string;
  /**
   * Weekday names ("Thursday") to switch off. Only meaningful with
   * frequency "Custom", which is the one choice that reveals the days.
   */
  deselectDays?: string[];
}

/**
 * Create a habit through the wizard and return to the dashboard.
 *
 * Two steps: the habit (name, icon, color, repeat), then partners, which is
 * skipped.
 */
export async function createHabit(
  page: Page,
  { title, frequency, deselectDays = [] }: HabitOptions,
) {
  await page.goto("/main/habits/new");
  await page.waitForLoadState("networkidle");

  // Step 1: the name is typed into the habit card itself.
  await page.getByLabel("Habit name").fill(title);

  // Repeat is a menu on its row. "Custom" carries the previous choice's days
  // over, so every day starts on and the caller switches off the ones it
  // wants free.
  if (frequency && !/^(daily|every day)$/i.test(frequency)) {
    await page.getByRole("button", { name: /^repeat/i }).click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(`^${frequency}`, "i") })
      .click();
  }
  for (const day of deselectDays) {
    await page.getByRole("button", { name: day, exact: true }).click();
  }

  await page.getByRole("button", { name: /^next$/i }).click();

  // Step 2: partners are optional.
  await page.getByRole("button", { name: /^create habit$/i }).click();

  await page.waitForURL(/\/main\/dashboard/, { timeout: 10000 });
}
