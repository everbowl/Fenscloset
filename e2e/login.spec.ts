import { expect, test } from "@playwright/test";
import { resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => resetAndSeed());

test("signed-out visitors are sent to login, which shows Forgot password and the DEV banner", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /dev mode/i })).toBeVisible();
});

test("Jeff logs in with 0535 once, is forced to change it, then 0535 is dead", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("jeff@everbowl.com");
  await page.getByLabel("Password").fill("0535");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole("alert").filter({ hasText: "one-time DEV password" })).toBeVisible();

  // Can't sneak into the app while the change is pending.
  await page.goto("/today");
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel("New password").fill("0535");
  await page.getByLabel("Type it again").fill("0535");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "DEV password" })).toBeVisible();

  await page.getByLabel("New password").fill("closet-rocks-2026");
  await page.getByLabel("Type it again").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: /look/ })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /dev mode/i })).toHaveCount(0); // DEV strip gone

  await page.goto("/profile");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("jeff@everbowl.com");
  await page.getByLabel("Password").fill("0535");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today$/);
});
