import type { Page } from "@playwright/test";
import { TEST_PASSWORD } from "./constants";

interface TestUser {
  email: string;
  password: string;
  name: string;
  username: string;
}

/**
 * Sign up a new user and skip onboarding if present.
 * Expects to land on /main/dashboard when done.
 */
export async function signUp(page: Page, user: TestUser) {
  await page.goto("/auth/signup");
  await page.waitForLoadState("networkidle");

  await page.getByLabel(/display name/i).fill(user.name);
  await page.getByLabel(/username/i).fill(user.username);
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page
    .getByRole("button", { name: /sign up|create account/i })
    .click();

  await page.waitForURL(/\/(main\/dashboard|auth\/onboarding)/, {
    timeout: 15000,
  });

  if (page.url().includes("onboarding")) {
    await skipOnboarding(page);
  }
}

/**
 * Log in an existing user.
 * Returns false if login fails (e.g. no seeded user).
 */
export async function logIn(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<boolean> {
  await page.goto("/auth/login");
  await page.waitForLoadState("networkidle");

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();

  try {
    await page.waitForURL(/\/main\/dashboard/, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Skip through onboarding wizard steps.
 */
export async function skipOnboarding(page: Page) {
  const skipButton = page.getByRole("button", {
    name: /skip|next|continue|get started/i,
  });
  let attempts = 0;
  while (
    (await skipButton.isVisible().catch(() => false)) &&
    attempts < 10
  ) {
    await skipButton.click();
    await page.waitForTimeout(500);
    attempts++;
  }
}
