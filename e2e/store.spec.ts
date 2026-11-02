import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe("add from a store", () => {
  test.beforeAll(() => resetAndSeed({ jeffReady: true }));

  test("a product link becomes pieces per color and size (tapped or said in words); several receipts at once become lines", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/add");
    await page.getByTestId("add-by-link").click();
    await expect(page).toHaveURL(/\/add\/store\?tab=link$/);
    await page.getByTestId("store-url").fill("https://mock.example/products/linen-blazer");
    await page.getByTestId("lookup").click();
    await expect(page.getByTestId("product-name")).toHaveText("Linen Blazer");
    await expect(page.getByTestId("row-image-Black")).toHaveAttribute("src", /blazer-black/); // the page's photo for that color
    // tapped: one size for all, a count beside a color
    await page.getByTestId("size-M").click();
    await expect(page.getByTestId("chosen-size")).toContainText("M");
    await page.getByRole("button", { name: "One more Black" }).click();
    await expect(page.getByTestId("qty-Black")).toHaveText("1");
    // said in words: fills the rows (Black ×2 replaces the 1; Oatmeal gets 1)
    await page.getByTestId("owned-words").fill("black ×2, oatmeal");
    await page.getByTestId("read-words").click();
    await expect(page.getByTestId("qty-Black")).toHaveText("2");
    await expect(page.getByTestId("qty-Oatmeal")).toHaveText("1");
    await page.getByRole("button", { name: "One fewer Black" }).click(); // back to 2 pieces in all
    await expect(page.getByTestId("add-to-closet")).toContainText("Add 2 to closet");
    await page.getByTestId("add-to-closet").click();
    await expect(page.getByTestId("added-strip")).toContainText("2 ready to check");

    // receipts: two in one pick, read side by side, one Add for both
    await page.getByTestId("tab-receipt").click();
    const dir = mkdtempSync(path.join(os.tmpdir(), "fc-receipt-"));
    const files = await Promise.all([1, 2].map(async (n) => {
      const file = path.join(dir, `receipt-${n}.jpg`);
      writeFileSync(file, await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 250, g: 250, b: 250 } } }).jpeg().toBuffer());
      return file;
    }));
    await page.getByTestId("receipt-file").setInputFiles(files);
    await expect(page.getByTestId("receipt-group")).toHaveCount(2);
    await expect(page.getByTestId("receipt-line")).toHaveCount(4, { timeout: 30_000 });
    await expect(page.getByTestId("receipt-progress")).toBeHidden();
    await expect(page.getByTestId("add-receipt")).toContainText("Add 6 pieces");
    await page.getByTestId("add-receipt").click();
    await expect(page.getByTestId("added-strip")).toContainText("6 ready to check");

    // the pieces run through the normal confirm card with the store's facts
    await page.goto("/add");
    await expect(page.getByRole("link", { name: /Confirm 8 ready/ })).toBeVisible({ timeout: 40_000 });
    await page.getByRole("link", { name: /Confirm 8 ready/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Linen Blazer");
    await expect(page.getByTestId("row-brand")).toContainText("Everlane · M");
    await expect(page.getByTestId("row-color")).toContainText("Black");
    await page.getByTestId("confirm-next").click();
    await expect(page.getByTestId("confirm-counter")).toHaveText("002 / 008");

    await page.goto("/closet");
    await page.getByTestId("item-card").first().click();
    await expect(page.getByText("Store photo", { exact: true })).toBeVisible();
  });
});
