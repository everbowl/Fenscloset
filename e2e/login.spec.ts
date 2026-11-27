import { expect, test } from "./fixtures";
import { resetAndSeed } from "./helpers";
import { DEV_PASSWORD } from "../prisma/seed-data";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => resetAndSeed());

test("signed-out visitors are sent to login, which shows Forgot password and the DEV banner", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByText("A private wardrobe for one family")).toBeVisible(); // the sign-in page names no family (security item 2)
  await expect(page.getByRole("status").filter({ hasText: /dev mode/i })).toBeVisible();
});

test("Avery logs in with the one-time password once, is forced to change it, then the one-time password is dead", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("avery@example.test");
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole("alert").filter({ hasText: "one-time DEV password" })).toBeVisible();

  // Can't sneak into the app while the change is pending.
  await page.goto("/today");
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel("New password").fill(`${DEV_PASSWORD}abcd`); // long enough for the field, still the DEV password inside: the server refuses it
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pick a real one" })).toBeVisible();
  // With the one-time password spent and no real password yet there is no way out but setting one (review A A2).
  await expect(page.getByTestId("change-password-signout")).toHaveCount(0);

  await page.getByLabel("New password").fill("closet-rocks-2026");
  await expect(page.getByTestId("password-strength")).toContainText("Strong enough");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByTestId("greeting")).toBeVisible(); // Today greets by name on v2
  await expect(page.getByRole("status").filter({ hasText: /dev mode/i })).toHaveCount(0); // DEV strip gone

  await page.goto("/profile");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("avery@example.test");
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  // An unknown address gets the same line as a wrong password (review A S11).
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("whatever-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await page.getByLabel("Email").fill("avery@example.test");

  await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today$/);
});
