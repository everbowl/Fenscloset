import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetAndSeed({ jeffReady: true });
  execSync("npx tsx e2e/seed-brands.ts Jeff Everlane Vuori", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB } });
});

test("new from your brands: the feed is built when the Shop opens, new this once, Judge it, Refresh; a kid with no brands", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/shop");
  // the feed is fetched in the background on the first open, then everything in it is new this once
  await expect(page.getByTestId("brand-feed-new")).toContainText(/^[1-9]\d* new$/, { timeout: 20000 });
  await expect(page.getByTestId("brand-feed-brands")).toContainText("Everlane · Vuori · checked just now");
  const products = page.getByTestId("brand-feed-product");
  expect(await products.count()).toBeGreaterThan(2);
  await expect(products.nth(0)).toContainText("Everlane");
  await expect(products.nth(1)).toContainText("Vuori");
  await expect(products.nth(0).getByText("New", { exact: true })).toBeVisible();
  // Judge it runs the Shop's verdict on that product
  await page.getByTestId("brand-feed-judge").first().click();
  await expect(page.getByTestId("shop-result")).toContainText("Linen Blazer", { timeout: 30000 });
  // opened once: nothing new; Refresh looks again (the same mock stores: still nothing new)
  await page.goto("/shop");
  await expect(page.getByTestId("brand-feed-new")).toHaveCount(0);
  await expect(page.getByTestId("brand-feed-product").first().getByText("New", { exact: true })).toHaveCount(0);
  await page.getByTestId("brand-feed-refresh").click();
  await expect(page.getByTestId("brand-feed-refresh")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("brand-feed-new")).toHaveCount(0);
  // shopping for Mya (a parent): she has no brands yet, and only she can pick them
  await page.getByTestId("shop-for").click();
  await page.getByRole("dialog").getByRole("option", { name: "Mya" }).click();
  await expect(page).toHaveURL(/for=/);
  await expect(page.getByTestId("brand-feed-none")).toContainText("When Mya picks favorite brands");
  await expect(page.getByTestId("brand-feed-pick")).toHaveCount(0);
});
