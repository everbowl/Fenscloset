import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe("add from a store", () => {
  test.beforeAll(() => resetAndSeed({ jeffReady: true }));

  test("a product link becomes pieces with the store photo, facts and a store-photo mark; a receipt becomes lines", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/add");
    await page.getByTestId("add-by-link").click();
    await expect(page).toHaveURL(/\/add\/store\?tab=link$/);
    await page.getByTestId("store-url").fill("https://mock.example/products/linen-blazer");
    await page.getByTestId("lookup").click();
    await expect(page.getByTestId("product-name")).toHaveText("Linen Blazer");
    await page.getByTestId("color-Black").click();
    await expect(page.getByTestId("product-image")).toHaveAttribute("src", /blazer-black/);
    await page.getByTestId("size-M").click();
    await page.getByRole("button", { name: "One more" }).click();
    await expect(page.getByTestId("quantity")).toHaveText("2");
    await page.getByTestId("add-to-closet").click();
    await expect(page.getByTestId("added-strip")).toContainText("2 ready to check");

    // receipt
    await page.getByTestId("tab-receipt").click();
    const dir = mkdtempSync(path.join(os.tmpdir(), "fc-receipt-"));
    const file = path.join(dir, "receipt.jpg");
    writeFileSync(file, await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 250, g: 250, b: 250 } } }).jpeg().toBuffer());
    await page.getByTestId("receipt-file").setInputFiles(file);
    await expect(page.getByTestId("receipt-line")).toHaveCount(2, { timeout: 20_000 });
    await page.getByTestId("add-receipt").click();
    await expect(page.getByTestId("added-strip")).toContainText("3 ready to check");

    // the pieces run through the normal confirm card with the store's facts
    await page.goto("/add");
    await expect(page.getByRole("link", { name: /Confirm 5 ready/ })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: /Confirm 5 ready/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Linen Blazer");
    await expect(page.getByTestId("row-brand")).toContainText("Everlane · M");
    await expect(page.getByTestId("row-color")).toContainText("Black");
    await page.getByTestId("confirm-next").click();
    await expect(page.getByTestId("confirm-counter")).toHaveText("002 / 005");

    await page.goto("/closet");
    await page.getByTestId("item-card").first().click();
    await expect(page.getByText("Store photo", { exact: true })).toBeVisible();
  });
});
