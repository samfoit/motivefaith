import type { Page } from "@playwright/test";

interface HabitOptions {
  title: string;
  frequency?: string;
  category?: string;
}

/**
 * Create a habit through the wizard and return to the dashboard.
 */
export async function createHabit(
  page: Page,
  { title, frequency = "daily", category = "fitness" }: HabitOptions,
) {
  await page.goto("/main/habits/new");
  await page.waitForLoadState("networkidle");

  // Step 1: Fill in habit name
  const titleInput = page
    .getByPlaceholder(/habit name|what.*habit/i)
    .or(page.getByLabel(/title|name/i));
  await titleInput.fill(title);

  const nextButton = page.getByRole("button", { name: /next|continue/i });

  // Advance past title step
  if (await nextButton.isVisible().catch(() => false)) {
    await nextButton.click();
    await page.waitForTimeout(300);
  }

  // Step 2: Select frequency
  const frequencyChip = page.getByText(new RegExp(frequency, "i"));
  if (await frequencyChip.isVisible().catch(() => false)) {
    await frequencyChip.click();
  }
  if (await nextButton.isVisible().catch(() => false)) {
    await nextButton.click();
    await page.waitForTimeout(300);
  }

  // Step 3: Select category
  const categoryChip = page.getByText(new RegExp(category, "i"));
  if (await categoryChip.isVisible().catch(() => false)) {
    await categoryChip.click();
  }
  if (await nextButton.isVisible().catch(() => false)) {
    await nextButton.click();
    await page.waitForTimeout(300);
  }

  // Step 4: Skip sharing step
  if (await nextButton.isVisible().catch(() => false)) {
    await nextButton.click();
    await page.waitForTimeout(300);
  }

  // Step 5: Submit on review step
  const createButton = page.getByRole("button", {
    name: /create habit|create|done/i,
  });
  if (await createButton.isVisible().catch(() => false)) {
    await createButton.click();
  }

  await page.waitForURL(/\/main\/dashboard/, { timeout: 10000 });
}
