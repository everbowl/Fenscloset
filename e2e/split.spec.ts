import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

/** Two shirts side by side in one photo. */
async function twoShirts(): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fc-split-"));
  const strip = (r: number, g: number, b: number) => sharp({ create: { width: 400, height: 600, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .composite([{ input: await strip(20, 20, 20), left: 0, top: 0 }, { input: await strip(250, 250, 250), left: 400, top: 0 }]).jpeg().toBuffer();
  const p = path.join(dir, "two-shirts.jpg");
  writeFileSync(p, buf);
  return p;
}

test.describe("several pieces in one photo", () => {
  test.beforeAll(() => resetAndSeed({ jeffReady: true }));

  test("Several pieces? on the card splits the photo into a card per garment", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/add");
    await page.getByTestId("pick-photos").setInputFiles(await twoShirts());
    const confirmLink = page.getByRole("link", { name: /Confirm 1 ready/ });
    await expect(confirmLink).toBeVisible({ timeout: 30_000 });
    await confirmLink.click();
    await expect(page.getByTestId("confirm-counter")).toHaveText("001 / 001");
    await page.getByTestId("split-entry").click();
    // the two garments are tagged as their own entries; the original stepped aside
    await expect.poll(async () => { await page.goto("/add"); return page.getByRole("link", { name: /Confirm 2 ready/ }).count(); }, { timeout: 40_000, intervals: [1000] }).toBe(1);
    await page.getByRole("link", { name: /Confirm 2 ready/ }).click();
    await expect(page.getByTestId("confirm-counter")).toHaveText(/00[12] \/ 003/);
    await page.getByTestId("confirm-next").click();
    await expect(page.getByTestId("confirm-counter")).toHaveText(/00[23] \/ 003/);
  });
});
