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
    // three doors first: photos, a store link, a receipt
    await expect(page.getByTestId("add-doors")).toBeVisible();
    // photo tips: general rules + a tab per category; hide for this person, bring back
    await expect(page.getByTestId("photo-tips")).toContainText("One piece per photo");
    // The tab row sits in the band under the fixed tab bar on a page just taller than the phone; mobile emulation mis-maps
    // the tap there, so the tab is picked by its own click event (the row scrolls fine for a thumb).
    await page.getByTestId("tip-tab-Shoes").dispatchEvent("click");
    await expect(page.getByTestId("tip-text")).toContainText("toes toward you");
    await page.getByTestId("hide-tips").click();
    await expect(page.getByTestId("show-tips")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("photo-tips")).toHaveCount(0);
    await page.getByTestId("show-tips").click();
    await expect(page.getByTestId("photo-tips")).toBeVisible();
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
    await expect(page.getByTestId("row-color")).toContainText("Black");
    await expect(page.getByTestId("row-brand")).toContainText("Scan the label");

    // brand as you type: a national brand joins the family's list; then match the style at the store
    await page.getByTestId("row-brand").click();
    await page.getByRole("dialog").getByText("Pick a brand").click();
    await page.getByTestId("brand-search").fill("nik");
    await page.getByRole("dialog").getByRole("option", { name: /^Nike/ }).click(); // seeded brand; a catalog brand not yet in the list shows as brand-national-<name>
    await expect(page.getByTestId("row-brand")).toContainText("Nike");
    await page.getByTestId("match-style").click();
    await page.getByTestId("match-0").click();
    await expect(page.getByTestId("photo-store")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("match-style")).toContainText("store photos added");
    await page.getByTestId("photo-front").click();

    // rename, then one tap
    await page.getByRole("button", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Black crew tee");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Black crew tee");

    // rotate: a quarter turn swaps in a new photo
    const unturned = await page.getByTestId("confirm-photo").getAttribute("src");
    await page.getByTestId("rotate").click();
    await expect(page.getByTestId("rotate")).toHaveText(/Rotate/, { timeout: 20_000 });
    await expect(page.getByTestId("confirm-photo")).not.toHaveAttribute("src", unturned!);

    // back of the piece
    await page.getByRole("button", { name: "Add a label or worn photo" }).click();
    await page.getByTestId("add-back").click();
    await page.getByTestId("back-photo").setInputFiles((await fixtures())[2]);
    await expect(page.getByTestId("photo-status")).toContainText("Back photo added");
    await expect(page.getByTestId("photo-back")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Black crew tee");
    await page.getByTestId("photo-front").click();
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
    await expect(page.getByText(/2 added to your closet/)).toBeVisible();
    await page.getByRole("link", { name: "Go to closet" }).click();
    await expect(page).toHaveURL(/\/closet$/);
  });
});
