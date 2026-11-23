import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

/**
 * The mirror keeps dressing while the person goes elsewhere (Jeff, 23 Nov 2026): close the sheet, leave the page, and
 * the bar under the header says where it stands; when it is done, "See it" opens the full-screen mirror. Needs
 * MOCK_TRYON_SLOW_MS in the web server's env (playwright.config.ts) so the stand-in takes longer than the quick window.
 */
test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetAndSeed({ jeffReady: true });
  execSync("npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB, MOCK_S3: "true" } });
});

test("a dressing started on Today keeps going on the closet; the bar lands on the full-screen mirror", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/mirror");
  await expect(page.getByTestId("mirror-empty")).toBeVisible(); // nothing dressed yet, and the page says what to do
  await expect(page.getByTestId("crumbs")).toContainText("Mirror");
  await page.goto("/today");
  await page.getByTestId("see-on-mannequin").click();
  await expect(page.getByTestId("mirror-progress")).toBeVisible({ timeout: 10_000 }); // the stand-in is slow on purpose
  await expect(page.getByTestId("mirror-strip")).toHaveCount(0); // the sheet is showing it: no bar
  await page.keyboard.press("Escape");
  const strip = page.getByTestId("mirror-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute("data-status", "running");
  await expect(strip).toContainText(/Dressing the mannequin/);
  await page.goto("/closet");
  await expect(page.getByTestId("mirror-strip")).toBeVisible(); // still there on another page
  await expect(page.getByTestId("mirror-strip")).toContainText("Your look is ready", { timeout: 30_000 }); // on a failure the bar's words say why
  await expect(page.getByTestId("mirror-strip")).toHaveAttribute("data-status", "done");
  await page.getByTestId("mirror-strip-see").click();
  await page.waitForURL(/\/mirror$/);
  await expect(page.getByTestId("mirror-screen")).toBeVisible();
  await expect(page.getByTestId("try-on-sheet").locator("img").first()).toHaveAttribute("src", /\/api\/photo\/mannequin\//);
  await expect(page.getByTestId("mirror-strip")).toHaveCount(0); // seen: the bar is gone
  await page.goto("/closet");
  await expect(page.getByTestId("mirror-strip")).toHaveCount(0);
  // the recent looks on /mirror bring a picture back without dressing anything
  await page.goto("/mirror");
  await expect(page.getByTestId("mirror-screen")).toBeVisible(); // the job is still in the shell
});

test("a reload mid-dressing keeps following the job", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/today");
  await page.getByTestId("see-on-mannequin").click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 }); // the picture from the first test, saved
  await page.getByTestId("redo-tryon").click(); // from scratch: the slow stand-in runs again
  await expect(page.getByTestId("mirror-progress")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("mirror-strip")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("mirror-strip")).toHaveAttribute("data-status", /running|done/);
  await expect(page.getByTestId("mirror-strip")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
});
