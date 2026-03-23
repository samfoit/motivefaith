import { test, expect } from "@playwright/test";

test.describe("Authentication flow", () => {
  test("new user can reach signup page and see form", async ({ page }) => {
    await page.goto("/auth/signup");
    await expect(
      page.getByRole("heading", { name: "Create Account" }),
    ).toBeVisible();
    await expect(page.getByLabel("Display Name")).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create account/i }),
    ).toBeVisible();
  });

  test("existing user can reach login page and see form", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.getByRole("heading", { name: "MotiveFaith" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
  });

  test("invalid credentials show error message on login", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill("nonexistent@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();
    // Expect an error indicator — either toast or field error state
    await expect(page.getByLabel("Password")).toHaveAttribute(
      "aria-invalid",
      "true",
      { timeout: 5000 },
    );
  });
});
