import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => resetAndSeed({ adminReady: true }));

test("signed-out visitors are sent to login, which shows Forgot password, names no family and pre-fills nothing", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByText("A private wardrobe for one family")).toBeVisible(); // security item 2
  await expect(page.getByLabel("Email")).toHaveValue(""); // security item 3: no address is pre-filled, DEV mode is gone
  await expect(page.getByRole("status").filter({ hasText: /dev mode/i })).toHaveCount(0);
});

test("a wrong password and an unknown address get the same line; the right password signs in; sign out returns to login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill("not-the-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("whatever-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByTestId("greeting")).toBeVisible();

  await page.goto("/profile");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
