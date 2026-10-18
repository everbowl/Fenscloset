import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

async function fixtures(): Promise<string[]> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fc-fixtures-"));
  const out: string[] = [];
  for (const [i, rgb] of [[20, 20, 20], [200, 30, 30], [30, 60, 200]].entries()) {
    const [r, g, b] = rgb;
    const buf = await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r, g, b } } })
      .composite([{ input: await sharp({ create: { width: 800, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), top: i * 250, left: 0 }])
      .jpeg().toBuffer();
    const p = path.join(dir, `piece-${i + 1}.jpg`);
    writeFileSync(p, buf);
    out.push(p);
  }
  return out;
}

test.describe("add clothes", () => {
  test.beforeAll(() => resetAndSeed({ jeffReady: true }));

  test("pick three photos, confirm with one tap each, reload mid-batch keeps the counter, all done", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/add");
    await expect(page.getByRole("heading", { name: /Add clothes/ })).toBeVisible();
    await page.getByTestId("pick-photos").setInputFiles(await fixtures());

    // uploads + mock tagging finish; the Add screen offers the confirm step
    const confirmLink = page.getByRole("link", { name: /Confirm 3 ready/ });
    await expect(confirmLink).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("batch-counter")).toHaveText("003 / 003");
    await confirmLink.click();

    // confirm step, design 03
    await expect(page.getByTestId("confirm-counter")).toHaveText("001 / 003");
    await expect(page.getByTestId("row-category")).toContainText("Tops");
    await expect(page.getByTestId("row-colour")).toContainText("Black");
    await expect(page.getByTestId("row-brand")).toContainText("Scan the label");

    // rename, then one tap
    await page.getByRole("button", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Black crew tee");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Black crew tee");
    await page.getByTestId("confirm-next").click();
    await expect(page.getByTestId("confirm-counter")).toHaveText("002 / 003");

    // closing and coming back keeps the place
    await page.reload();
    await expect(page.getByTestId("confirm-counter")).toHaveText("002 / 003");

    // change the category through the row editor (values come from the lists)
    await page.getByTestId("row-category").click();
    await page.getByRole("dialog").getByRole("option", { name: "Bottoms" }).click();
    await page.getByRole("dialog").getByRole("option", { name: "Jeans" }).click();
    await expect(page.getByTestId("row-category")).toContainText("Bottoms · Jeans");
    await page.getByTestId("confirm-next").click();
    await expect(page.getByTestId("confirm-counter")).toHaveText("003 / 003");
    await page.getByRole("button", { name: "Skip" }).click();

    await expect(page.getByRole("heading", { name: /All done/ })).toBeVisible();
    await expect(page.getByText(/002 added/)).toBeVisible();
    await page.getByRole("link", { name: "Go to closet" }).click();
    await expect(page).toHaveURL(/\/closet$/);
  });
});
