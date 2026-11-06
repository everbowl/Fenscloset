import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetAndSeed({ jeffReady: true });
  execSync("npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB, MOCK_S3: "true" } });
});

test("a top asks for a bottom, then shoes (the mannequin can wear them); the picture; other tops under it swap in and dress again", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/closet");
  await page.getByRole("link", { name: /white tee/i }).first().click();
  await expect(page.getByTestId("see-on-me")).toContainText("See it on a mannequin"); // no body photo yet
  await page.getByTestId("see-on-me").click();
  await expect(page.getByTestId("complete-look")).toBeVisible();
  await expect(page.getByTestId("complete-ask")).toHaveText("Add a bottom?");
  await expect(page.getByTestId("complete-chosen")).toContainText("white tee");
  await expect(page.getByTestId("complete-skip")).toHaveText("Just the top");
  await expect(page.getByTestId("complete-option")).toHaveCount(1); // the one pair of jeans
  await page.getByTestId("complete-option").filter({ hasText: /dark jeans/i }).click();
  await expect(page.getByTestId("complete-ask")).toHaveText("Add shoes?");
  await expect(page.getByTestId("complete-skip")).toHaveText("No shoes");
  await page.getByTestId("complete-option").filter({ hasText: /sneakers/i }).click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("mirror-pieces")).toHaveText(/white tee · .*dark jeans · .*sneakers/i);
  await expect(page.getByTestId("try-on-sheet")).toContainText("On a mannequin");
  // under the picture: other tops (the black tee, the blazer, the old parka); no "Add a bottom" since the look has one, no other bottoms
  await expect(page.getByTestId("mirror-go-with")).toBeVisible();
  await expect(page.getByTestId("mirror-row-top")).toContainText("Other tops");
  await expect(page.getByTestId("mirror-row-top").getByTestId("mirror-swap")).toHaveCount(3);
  await expect(page.getByTestId("mirror-row-bottom")).toHaveCount(0);
  await expect(page.getByTestId("mirror-row-shoes")).toHaveCount(0); // one pair of shoes, already on
  const before = await page.getByTestId("try-on-sheet").locator("img").first().getAttribute("src");
  await page.getByTestId("mirror-row-top").getByTestId("mirror-swap").filter({ hasText: /black tee/i }).click();
  await expect(page.getByTestId("mirror-pieces")).toHaveText(/black tee · .*dark jeans · .*sneakers/i, { timeout: 20_000 });
  await expect(page.getByTestId("mirror-pieces")).not.toContainText("white tee");
  await expect(page.getByTestId("try-on-sheet").locator("img").first()).not.toHaveAttribute("src", before!);
  await expect(page.getByTestId("mirror-row-top").getByTestId("mirror-swap").filter({ hasText: /white tee/i })).toHaveCount(1);
  await expect(page.getByTestId("mirror-shop-go-with")).toHaveAttribute("href", /\/closet\/.+\/go-with/);
});

test("from the closet's picks a bottom asks for a top; both can be declined; the rows under the picture offer what is missing", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/closet");
  await page.getByTestId("closet-mirror").click();
  await page.getByTestId("item-card").filter({ hasText: /dark jeans/i }).click();
  await page.getByTestId("see-picked").click();
  await expect(page.getByTestId("complete-ask")).toHaveText("Add a top?");
  await expect(page.getByTestId("complete-option")).toHaveCount(4); // two tees, the blazer, the old parka
  await expect(page.getByTestId("complete-skip")).toHaveText("Just the bottom");
  await page.getByTestId("complete-skip").click();
  await expect(page.getByTestId("complete-ask")).toHaveText("Add shoes?");
  await page.getByTestId("complete-skip").click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("mirror-pieces")).toHaveText(/dark jeans/i);
  await expect(page.getByTestId("mirror-row-top")).toContainText("Add a top");
  await expect(page.getByTestId("mirror-row-shoes")).toContainText("Add shoes");
  await expect(page.getByTestId("mirror-row-bottom")).toHaveCount(0);
  // a tap on shoes under the picture adds them
  await page.getByTestId("mirror-row-shoes").getByTestId("mirror-swap").first().click();
  await expect(page.getByTestId("mirror-pieces")).toHaveText(/dark jeans · .*sneakers/i, { timeout: 20_000 });
  await expect(page.getByTestId("mirror-row-shoes")).toHaveCount(0);
  // a top and a bottom picked together ask only about shoes
  await page.keyboard.press("Escape");
  await page.getByTestId("item-card").filter({ hasText: /white tee/i }).click();
  await page.getByTestId("see-picked").click();
  await expect(page.getByTestId("complete-ask")).toHaveText("Add shoes?");
  await page.getByTestId("complete-option").first().click();
  await expect(page.getByTestId("mirror-pieces")).toContainText("white tee", { timeout: 20_000 });
  await expect(page.getByTestId("mirror-pieces")).toContainText("dark jeans");
  await expect(page.getByTestId("mirror-pieces")).toContainText("sneakers");
});

test("on your own photo with FASHN there is no shoes question, and a line says why; a one-piece asks nothing", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/profile/body");
  const buffer = Buffer.from(await (await import("sharp")).default({ create: { width: 300, height: 400, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toBuffer());
  await page.getByTestId("body-photo").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer });
  await expect(page.locator("[data-testid^=body-photo-]").first()).toBeVisible();
  execSync("npx tsx e2e/seed-color.ts 'Jeff linen blazer' 'beige|cream|tan|oat'", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB, MOCK_S3: "true" } });
  await page.goto("/closet");
  await page.getByRole("link", { name: /white tee/i }).first().click();
  await expect(page.getByTestId("see-on-me")).toContainText("See it on me");
  await page.getByTestId("see-on-me").click();
  await expect(page.getByTestId("complete-ask")).toHaveText("Add a bottom?");
  await expect(page.getByTestId("complete-shoes-note")).toContainText("Shoes can’t go in this picture yet");
  await page.getByTestId("complete-option").first().click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 }); // straight to the picture: no shoes question on FASHN
  await expect(page.getByTestId("mirror-pieces")).toHaveText(/white tee · .*dark jeans/i);
  await expect(page.getByTestId("try-on-sheet")).toContainText("dressed by FASHN");
  await expect(page.getByTestId("mirror-row-shoes")).toHaveCount(0);
  await expect(page.getByTestId("mirror-row-top")).toContainText("Other tops");
});
