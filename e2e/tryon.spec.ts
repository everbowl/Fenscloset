import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetAndSeed({ jeffReady: true });
  execSync("npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB, MOCK_S3: "true" } });
});

test("try-on: off by default, opt in, needs a body photo, then a picture of the look on you (yours alone)", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/today");
  // no try-on of his own yet: SEE IT ON dresses the mannequin (no body photo involved), with a nudge toward Settings
  await expect(page.getByTestId("try-on-off")).toBeVisible();
  await page.getByTestId("see-on-mannequin").click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("dialog")).toContainText("On a mannequin");
  await expect(page.getByTestId("try-on-sheet")).toContainText("No body photo used");
  await expect(page.getByTestId("try-on-sheet").locator("img")).toHaveAttribute("src", /\/api\/photo\/mannequin\//);
  await page.keyboard.press("Escape");
  await page.goto("/profile/settings");
  await expect(page.getByTestId("tryon-toggle")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("tryon-toggle").click();
  await expect(page.getByTestId("tryon-toggle")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("tryon-section")).toContainText("Body page");
  await page.goto("/today");
  await expect(page.getByTestId("try-on-photo")).toBeVisible();
  await page.goto("/profile/body");
  const buffer = Buffer.from(await (await import("sharp")).default({ create: { width: 300, height: 400, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toBuffer());
  await page.getByTestId("body-photo").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer });
  await expect(page.locator("[data-testid^=body-photo-]").first()).toBeVisible();
  await page.goto("/today");
  await expect(page.getByTestId("see-on-mannequin")).toHaveCount(0);
  await page.getByTestId("try-on").click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("try-on-sheet")).toContainText("Only you can see this picture");
  await expect(page.getByTestId("try-on-sheet").locator("img")).toHaveAttribute("src", /\/api\/photo\/tryon\//);
});
