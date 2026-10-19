import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetAndSeed({ jeffReady: true });
  execSync("npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env: { ...process.env, DATABASE_URL: E2E_DB, MOCK_S3: "true" } });
});

test("try-on: on by default, needs a body photo, then a picture of the look on you (yours alone)", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/today");
  // no body photo yet: SEE IT ON dresses the mannequin (no body photo involved), with a nudge toward the Body page
  await expect(page.getByTestId("try-on-photo")).toBeVisible();
  await expect(page.getByTestId("try-on-off")).toHaveCount(0); // nothing to switch on first
  await page.getByTestId("see-on-mannequin").click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("dialog")).toContainText("On a mannequin");
  await expect(page.getByTestId("try-on-sheet")).toContainText("No body photo used");
  await expect(page.getByTestId("try-on-sheet").locator("img")).toHaveAttribute("src", /\/api\/photo\/mannequin\//);
  await page.keyboard.press("Escape");
  await page.goto("/profile/settings");
  await expect(page.getByTestId("tryon-toggle")).toHaveAttribute("aria-checked", "true"); // on from the start; the switch is there for anyone who wants it off
  await expect(page.getByTestId("tryon-section")).toContainText("Body page");
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
  await expect(page.getByTestId("mirror-back")).toHaveCount(0); // no back photo yet
  // how it shows: untucked by default (the look has a top and a bottom); a chip re-styles the same picture
  await expect(page.getByTestId("mirror-styling")).toBeVisible();
  await expect(page.getByTestId("styling-summary")).toContainText("Untucked");
  const firstSrc = await page.getByTestId("try-on-sheet").locator("img").getAttribute("src");
  await page.getByTestId("style-group-tuck").getByRole("button", { name: "Tucked", exact: true }).click();
  await expect(page.getByTestId("styling-summary")).toContainText("Tucked", { timeout: 20_000 });
  await expect(page.getByTestId("try-on-sheet").locator("img")).not.toHaveAttribute("src", firstSrc!);
  await page.getByTestId("style-group-pose").getByRole("button", { name: "Hands in pockets" }).click();
  await expect(page.getByTestId("styling-summary")).toContainText("Hands in pockets", { timeout: 20_000 });
  await page.keyboard.press("Escape");
  // remembered: the mirror opens the way it was left
  await page.reload();
  await page.getByTestId("try-on").click();
  await expect(page.getByTestId("styling-summary")).toContainText("Tucked · ", { timeout: 20_000 });
  await expect(page.getByTestId("styling-summary")).toContainText("Hands in pockets");
  await page.keyboard.press("Escape");

  // a back photo: the mirror can show the look from behind
  await page.goto("/profile/body");
  await page.getByTestId("add-body-photo-back").click();
  await page.getByTestId("photo-shared").click();
  await page.getByTestId("body-photo").setInputFiles({ name: "back.jpg", mimeType: "image/jpeg", buffer });
  await expect(page.locator("[data-testid^=body-photo-][data-view=back]")).toBeVisible();
  await page.goto("/today");
  await page.getByTestId("try-on").click();
  await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("mirror-back").click();
  await expect(page.getByTestId("try-on-sheet")).toContainText("from behind", { timeout: 20_000 });
});
