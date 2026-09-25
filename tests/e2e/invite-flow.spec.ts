import { test, expect } from "@playwright/test";
import { TEST_PASSWORD, uniqueEmail, uniqueUsername } from "./helpers/constants";
import { signUp, skipOnboarding } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Invite Flow E2E
// ---------------------------------------------------------------------------
// The journey this feature exists for: one person sends a link, the other
// person does not have an account yet, and the two of them end up connected
// without either ever typing a username.
//
// The load-bearing part is the middle — signup. The invite has to survive a
// page the app fully navigates away from, which is why it is held in a cookie
// rather than a query parameter, and why every auth screen ends by asking
// where to go rather than assuming the dashboard.
//
// Requires a running local Supabase instance.
// ---------------------------------------------------------------------------

test.describe("Invite flow", () => {
  test("a shared link signs a stranger up and lands a friend request", async ({
    page,
  }) => {
    const inviter = {
      email: uniqueEmail("inviter"),
      password: TEST_PASSWORD,
      name: "Invite Sender",
      username: uniqueUsername("sender"),
    };

    await signUp(page, inviter);

    // --- The sender finds their link ---------------------------------------
    await page.goto("/main/friends");
    await page.getByRole("button", { name: /invite/i }).first().click();

    const link = page.getByText(new RegExp(`/invite/${inviter.username}$`));
    await expect(link).toBeVisible({ timeout: 5000 });

    // --- A stranger opens it -----------------------------------------------
    await page.context().clearCookies();
    await page.goto(`/invite/${inviter.username}`);

    // Logged out, RLS gives us the username and nothing else — which is still
    // enough to say who sent this.
    await expect(
      page.getByRole("heading", { name: new RegExp(`@${inviter.username}`) }),
    ).toBeVisible();

    await page.getByRole("button", { name: /create your account/i }).click();
    await page.waitForURL(/\/auth\/signup/);

    // --- They sign up ------------------------------------------------------
    const invitee = {
      email: uniqueEmail("invitee"),
      password: TEST_PASSWORD,
      name: "Invite Receiver",
      username: uniqueUsername("receiver"),
    };

    await page.getByLabel(/display name/i).fill(invitee.name);
    await page.getByLabel(/username/i).fill(invitee.username);
    await page.getByLabel(/email/i).fill(invitee.email);
    await page.getByLabel(/password/i).fill(invitee.password);
    await page.getByRole("button", { name: /sign up|create account/i }).click();

    await page.waitForURL(/\/(auth\/onboarding|invite)/, { timeout: 15000 });
    if (page.url().includes("onboarding")) {
      await skipOnboarding(page);
    }

    // --- and come out the far side back at the invite ----------------------
    await page.waitForURL(new RegExp(`/invite/${inviter.username}`), {
      timeout: 15000,
    });

    // Someone who signed up *for* this invite does not get asked again: the
    // request sends itself.
    await expect(
      page.getByRole("heading", { name: /request sent/i }),
    ).toBeVisible({ timeout: 10000 });

    // --- The sender has it -------------------------------------------------
    await page.goto("/main/friends");
    await page.getByRole("tab", { name: /requests/i }).click();
    await expect(page.getByText(`@${invitee.username}`)).toBeVisible({
      timeout: 10000,
    });
  });

  test("an unknown username is a dead end, not a crash", async ({ page }) => {
    await page.goto("/invite/nobody_by_that_name");
    await expect(
      page.getByRole("heading", { name: /invite not found/i }),
    ).toBeVisible();
  });

  test("a malformed link is rejected before it reaches a query", async ({
    page,
  }) => {
    await page.goto("/invite/..%2F..%2Fadmin");
    await expect(
      page.getByRole("heading", { name: /invite not found/i }),
    ).toBeVisible();
  });
});
