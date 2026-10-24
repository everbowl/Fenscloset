import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetAndSeed({ jeffReady: true });
  execSync("npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB, MOCK_S3: "true" } });
});

test("link lookup for me, photo lookup for Mya as a parent, recent list and remove", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/shop");
  await expect(page.getByTestId("shop-empty")).toBeVisible();
  await page.getByTestId("paste-link").click();
  await page.getByRole("dialog").getByRole("textbox").fill("https://mock.example/p/1");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("shop-result")).toBeVisible();
  await expect(page.getByTestId("shop-result")).toContainText("Linen Blazer");
  await expect(page.getByTestId("verdict")).toContainText(/Fits|Risky|Pass/);
  await expect(page.getByTestId("pairings")).toBeVisible();

  // shop for Mya (parent): the switcher lists her; Olivia is not offered
  await page.getByTestId("shop-for").click();
  await expect(page.getByRole("dialog").getByRole("option", { name: "Olivia" })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("option", { name: "Mya" }).click();
  await expect(page).toHaveURL(/for=/);
  await page.getByTestId("upload-screenshot").click();
  await page.getByTestId("shop-file").setInputFiles({ name: "shot.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await (await import("sharp")).default({ create: { width: 200, height: 260, channels: 3, background: { r: 40, g: 40, b: 40 } } }).jpeg().toBuffer()) });
  await expect(page.getByTestId("shop-result")).toContainText("For Mya");
  // Mya's closet is empty, so Bottoms are missing: a scrollable row of real products (mocked) from several stores
  await expect(page.getByTestId("products")).toContainText("Bottoms to go with it");
  expect(await page.getByTestId("product").count()).toBeGreaterThan(3);
  await expect(page.getByTestId("product").first()).toContainText("$");
  // JUDGE IT runs the verdict on that product's link
  await page.getByTestId("judge-product").first().click();
  await expect(page.getByTestId("shop-result")).toContainText("Linen Blazer");
  await page.getByTestId("remove-lookup").click();
  // the screenshot lookup for Mya is what's left, so it is shown; removing it too empties the screen
  await expect(page.getByTestId("shop-result")).toContainText("For Mya");
  await expect(page.getByTestId("shop-result")).not.toContainText("Linen Blazer");
  await page.getByTestId("remove-lookup").click();
  await expect(page.getByTestId("shop-empty")).toBeVisible();
});
