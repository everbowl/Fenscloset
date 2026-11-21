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
    await expect(page.getByTestId("added-strip")).toContainText("2 added to the closet"); // C1: no confirm card for store pieces

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
    await expect(page.getByTestId("added-strip")).toContainText("6 added to the closet");

    // the pieces land in the closet on their own once tagged (C1); two of the same color and size are one card with ×2 (F)
    // 2 link rows (Oatmeal 1, Black 1) + 2 receipts × 2 lines; the page is server-rendered, so reload until the tagging is through
    await expect.poll(async () => { await page.goto("/closet"); return page.getByTestId("item-card").count(); }, { timeout: 40_000, intervals: [1000] }).toBe(6);
    await expect(page.getByTestId("copies-badge").first()).toContainText("×2"); // the receipt's "Crew Tee ×2"
    await page.getByTestId("item-card").filter({ has: page.getByTestId("copies-badge") }).first().click();
    await expect(page.getByText("Store photo", { exact: true })).toBeVisible();
    await expect(page.getByTestId("store-photo-line")).toContainText("add your own"); // C4
    await expect(page.getByTestId("copies")).toHaveText("2");
    // laundry one copy at a time: one in the wash, one still clean
    await page.getByTestId("one-dirty").click();
    await expect(page.getByTestId("copies-line")).toContainText("1 clean · 1 in the wash");
    await page.getByTestId("all-clean").click();
    await expect(page.getByTestId("copies-line")).toContainText("2 clean");
    await page.getByRole("button", { name: "One more copy" }).click();
    await expect(page.getByTestId("copies")).toHaveText("3");
  });
});
