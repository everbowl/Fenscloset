import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetAndSeed({ jeffReady: true });
  execSync("npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB, MOCK_S3: "true" } });
});

test("a look from a store find and the closet: the tray, the look screen, the mannequin, a name under Fits", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  // a Looking-for line brings store finds; one of them goes into a look
  await page.goto("/shop/looking-for");
  await page.getByTestId("want-add").click();
  await page.getByTestId("want-text").fill("navy cashmere crewneck");
  await page.getByTestId("want-save").click();
  await expect(page.getByTestId("want-row")).toContainText("navy cashmere crewneck", { timeout: 20_000 });
  await page.getByTestId("want-row").click();
  await expect(page.getByTestId("want-match").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("look-tray")).toHaveCount(0);
  await page.getByTestId("want-add-look").first().click();
  await expect(page.getByTestId("want-add-look").first()).toHaveText("In the look ✓");
  await expect(page.getByTestId("look-tray")).toContainText("Look · 1 piece");
  // the same find again is kept once
  await page.reload();
  await page.getByTestId("want-add-look").first().click();
  await expect(page.getByTestId("look-tray")).toContainText("Look · 1 piece");

  // the closet's pick mode adds what Jeff owns
  await page.goto("/closet");
  await expect(page.getByTestId("look-tray")).toContainText("Look · 1 piece");
  await page.getByTestId("closet-mirror").click();
  await page.getByTestId("item-card").filter({ hasText: /dark jeans/i }).click();
  await page.getByTestId("pick-add-look").click();
  await expect(page.getByTestId("look-tray")).toContainText("Look · 2 pieces");

  // the look screen: the pieces with Buy on the store find, more from the closet, the mannequin
  await page.getByTestId("look-tray").click();
  await expect(page).toHaveURL(/\/looks\//);
  await expect(page.getByTestId("look-eyebrow")).toContainText("not saved yet");
  await expect(page.getByTestId("look-piece")).toHaveCount(2);
  await expect(page.getByTestId("look-piece").first()).toContainText("to buy");
  await expect(page.getByTestId("look-piece").first().getByRole("link", { name: /^Buy/ })).toBeVisible();
  await expect(page.getByTestId("look-line")).toContainText("2 of 5 · 1 to buy");
  await page.getByTestId("look-add-closet").click();
  await page.locator("[data-testid^=look-pick-]:not([disabled])").first().click(); // the jeans are already in it (dimmed); any other piece
  await page.getByTestId("look-add-picked").click();
  await expect(page.getByTestId("look-piece")).toHaveCount(3);
  await page.getByTestId("look-see-on-mannequin").click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("try-on-sheet")).toContainText("On a mannequin");
  await expect(page.getByTestId("mirror-pieces")).toContainText("Navy Cashmere Crewneck");
  await page.keyboard.press("Escape");

  // a name saves it under Fits → Looks; the tray is empty again
  await page.getByTestId("look-save").click();
  await page.getByRole("dialog").getByLabel("Name").fill("Date night");
  await page.getByRole("dialog").getByRole("button", { name: "Save the look" }).click();
  await expect(page.getByTestId("look-eyebrow")).toContainText("saved under Fits");
  await page.goto("/fits");
  await expect(page.getByTestId("looks-row")).toContainText("Looks · 1");
  await expect(page.getByTestId("look-card")).toContainText("Date night");
  await expect(page.getByTestId("look-card")).toContainText("3 pieces · 1 to buy");
  await page.goto("/shop");
  await expect(page.getByTestId("look-tray")).toHaveCount(0);
  // + New look starts the next one
  await page.goto("/fits");
  await page.getByTestId("new-look").click();
  await expect(page).toHaveURL(/\/looks\//);
  await expect(page.getByTestId("look-empty")).toBeVisible();
});
