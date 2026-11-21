import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe("what's needed on the closet page", () => {
  test.beforeAll(() => {
    resetAndSeed({ jeffReady: true });
    execSync("npx tsx e2e/seed-brands.ts Jeff Everlane", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB } });
  });

  test("the strip lists the gaps; Not now hides one; a size and a front photo added in the row clear their rows", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/closet");
    const strip = page.getByTestId("needs");
    await expect(strip).toContainText("What’s needed");
    await expect(page.getByTestId("needs-count")).toHaveText("2");
    await expect(page.getByTestId("need-body-front")).toContainText("A front photo, so the mirror can dress you");
    const size = page.locator("[data-testid^=need-size-]");
    await expect(size).toContainText("Your size in Everlane");

    // the size, right in the row: the Brands page's sheet
    await size.getByRole("button", { name: "Add size" }).click();
    await page.getByTestId("my-size-tops").click();
    await page.getByTestId("size-sheet").getByRole("option", { name: "M", exact: true }).click();
    await page.getByTestId("save-my-brand").click();
    await expect(page.locator("[data-testid^=need-size-]")).toHaveCount(0);
    await expect(page.getByTestId("needs-count")).toHaveText("1");

    // the front photo, right in the row: the same privacy ask as the Body page
    const buffer = Buffer.from(await (await import("sharp")).default({ create: { width: 300, height: 400, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toBuffer());
    await page.getByTestId("need-add-body-front").click();
    await page.getByTestId("need-photo-only-me").click();
    await page.getByTestId("need-body-photo").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer });
    await expect(page.getByTestId("need-body-front")).toHaveCount(0);
    await expect(page.getByTestId("need-body-back")).toContainText("A back photo");
    await page.goto("/profile/body");
    await expect(page.locator("[data-testid=body-photo-locked][data-view=front]")).toBeVisible(); // Only me, as picked

    // Not now: the row goes and stays gone
    await page.goto("/closet");
    await page.getByTestId("need-not-now-body-back").click();
    await expect(page.getByTestId("need-body-back")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("needs")).toHaveCount(0);
  });
});
