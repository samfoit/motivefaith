import { test, expect } from "@playwright/test";

test.describe("Dark mode", () => {
  test("toggle to dark applies data-theme='dark'", async ({ page }) => {
    await page.goto("/auth/login");
    // The theme toggle is on the profile page. For a public page test,
    // verify we can set the theme via localStorage and it applies on load.
    await page.evaluate(() => {
      localStorage.setItem("motive-theme", "dark");
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("theme persists across page navigation", async ({ page }) => {
    await page.goto("/auth/login");
    await page.evaluate(() => {
      localStorage.setItem("motive-theme", "dark");
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Navigate to signup
    await page.getByText("Sign up").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("system theme responds to prefers-color-scheme", async ({ page }) => {
    // Emulate dark color scheme
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/auth/login");
    // With system preference, localStorage should be 'system' (default)
    // and resolved theme should be dark
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
