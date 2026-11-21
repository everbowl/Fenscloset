import { expect, test } from "@playwright/test";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { resetAndSeed({ jeffReady: true }); });

test("looking for: add a line, the stores are searched, the new count shows on the Shop and Today, the matches page, Judge it, found, edit, remove", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/shop");
  await expect(page.getByTestId("looking-for-line")).toContainText("Tell the Shop what to find");
  await page.getByTestId("looking-for-link").click();
  await expect(page).toHaveURL(/\/shop\/looking-for/);
  await expect(page.getByTestId("looking-for-empty")).toBeVisible();
  await page.getByTestId("want-add").click();
  await page.getByTestId("want-text").fill("navy cashmere crewneck under $100");
  await page.getByTestId("want-save").click();
  // the row appears with what the (mock) stores had under the cap, all counted as new
  const row = page.getByTestId("want-row");
  await expect(row).toContainText("navy cashmere crewneck under $100", { timeout: 20000 });
  await expect(page.getByTestId("want-new")).toContainText(/[1-9]\d* new/, { timeout: 20000 });
  await expect(page.getByTestId("want-row-line")).toContainText(/matches .* stores .* checked just now/);
  const newCount = Number((await page.getByTestId("want-new").textContent())!.match(/\d+/)![0]);
  // the Shop's line and Today's strip say so
  await page.goto("/shop");
  await expect(page.getByTestId("looking-for-line")).toContainText(`${newCount} new matches · 1 on the list`);
  await page.goto("/today");
  await expect(page.getByTestId("looking-for-strip")).toContainText(`${newCount} new matches`);
  await page.getByTestId("looking-for-strip").click();
  await expect(page).toHaveURL(/\/shop\/looking-for\?for=/);
  // the matches page: every match new this once; every one under the cap; Judge it lands on the Shop
  await page.getByTestId("want-row").click();
  await expect(page).toHaveURL(/\/shop\/looking-for\/[a-z0-9]+$/);
  const wantUrl = page.url();
  await expect(page.getByTestId("want-title")).toContainText("navy cashmere crewneck under $100");
  await expect(page.getByTestId("want-fresh")).toContainText(`${newCount} new since you last looked`);
  expect(await page.getByTestId("want-match").count()).toBe(newCount);
  for (const price of await page.getByTestId("want-match").locator(".mono").allTextContents()) {
    const m = price.match(/\$(\d+)/); if (m) expect(Number(m[1])).toBeLessThanOrEqual(100);
  }
  await page.getByTestId("want-judge").first().click();
  await expect(page).toHaveURL(/\/shop\?.*link=/);
  await expect(page.getByTestId("shop-result")).toContainText("Linen Blazer", { timeout: 30000 });
  // opened once: nothing new any more, on the page, the list, the Shop and Today
  await page.goto(wantUrl);
  await expect(page.getByTestId("want-fresh")).toHaveCount(0);
  await page.getByTestId("header-back").click();
  await expect(page.getByTestId("want-new")).toHaveCount(0);
  await page.goto("/today");
  await expect(page.getByTestId("looking-for-strip")).toHaveCount(0);
  // search now runs again (nothing new from the same mock stores); edit reads the line again; found it; back; remove
  await page.goto("/shop/looking-for");
  await page.getByTestId("want-row").click();
  await page.getByTestId("want-search-now").click();
  await expect(page.getByTestId("want-checked")).toContainText("checked just now", { timeout: 20000 });
  await expect(page.getByTestId("want-fresh")).toHaveCount(0);
  await page.getByTestId("want-edit").click();
  await page.getByTestId("want-text").fill("camel wool overcoat under $300");
  await page.getByTestId("want-save").click();
  await expect(page.getByTestId("want-title")).toContainText("camel wool overcoat under $300");
  await expect(page.getByTestId("want-matches")).toContainText(/matches from/, { timeout: 20000 });
  await page.getByTestId("want-found").click();
  await expect(page.getByTestId("want-unfound")).toBeVisible();
  await page.getByTestId("header-back").click();
  await expect(page.getByTestId("found-row")).toContainText("camel wool overcoat");
  await expect(page.getByTestId("looking-for-empty")).toBeVisible();
  await page.getByTestId("found-row").click();
  await page.getByTestId("want-unfound").click();
  await expect(page.getByTestId("want-found")).toBeVisible();
  await page.getByTestId("want-delete").click();
  await expect(page.getByTestId("want-undo")).toContainText("Taken off the list"); // five seconds to change your mind
  await expect(page).toHaveURL(/\/shop\/looking-for\?for=/, { timeout: 15_000 });
  await expect(page.getByTestId("looking-for-empty")).toBeVisible();
  await expect(page.getByTestId("want-row")).toHaveCount(0);
});
