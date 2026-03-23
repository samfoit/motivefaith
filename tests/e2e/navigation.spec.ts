import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  // These tests verify the public-facing navigation elements.
  // Authenticated routes (bottom nav) require login, so we test
  // the auth pages' link navigation which is publicly accessible.

  test("login page links navigate correctly", async ({ page }) => {
    await page.goto("/auth/login");
    // Click "Sign up" link
    await page.getByText("Sign up").click();
    await expect(page).toHaveURL(/\/auth\/signup/);
    await expect(
      page.getByRole("heading", { name: "Create Account" }),
    ).toBeVisible();
  });

  test("signup page links navigate correctly", async ({ page }) => {
    await page.goto("/auth/signup");
    // Click "Sign in" link
    await page.getByText("Sign in").click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole("heading", { name: "MotiveFaith" })).toBeVisible();
  });

  test("unauthenticated user is redirected from dashboard to login", async ({
    page,
  }) => {
    await page.goto("/main/dashboard");
    // Middleware should redirect to login
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
  });
});
