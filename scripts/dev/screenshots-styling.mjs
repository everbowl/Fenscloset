/** Dev-only: the mirror's styling chips (pose, tuck, buttons…), the admin lists behind them, and "Made with" on an item — on :3100 (e2e DB, mocks). */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import sharp from "sharp";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff Mya", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
const body = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 196, g: 178, b: 160 } } }).jpeg().toBuffer();
async function login(page) {
  await page.goto(base + "/login");
  await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
}
async function ready(page) {
  await page.goto(base + "/profile/body"); await page.getByTestId("body-photo").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: body });
  await page.locator("[data-testid^=body-photo-]").first().waitFor();
}
// phone
{
  const ctx = await browser.newContext({ ...devices["iPhone 15"] });
  const page = await ctx.newPage();
  await login(page); await ready(page);
  await page.goto(base + "/today");
  await page.getByTestId("try-on").click(); await page.getByTestId("mirror-styling").waitFor({ timeout: 20000 }); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/200-mirror-sheet.png` });
  await page.getByTestId("mirror-styling").scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/201-mirror-chips.png` });
  await page.getByTestId("style-group-tuck").getByRole("button", { name: "Tucked", exact: true }).click();
  await page.getByTestId("styling-summary").filter({ hasText: "Tucked" }).waitFor({ timeout: 20000 });
  await page.getByTestId("style-group-pose").getByRole("button", { name: "Hands in pockets" }).click();
  await page.getByTestId("styling-summary").filter({ hasText: "Hands in pockets" }).waitFor({ timeout: 20000 }); await page.waitForTimeout(300);
  await page.getByTestId("try-on-sheet").locator("img").scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/202-mirror-tucked-pockets.png` });
  await page.keyboard.press("Escape");
  await page.goto(base + "/admin/lists/wearOption"); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/203-admin-wear-options.png` });
  await page.goto(base + "/admin/lists/mirrorPose"); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/204-admin-poses.png` });
  await page.goto(base + "/admin/lists/wearGroup"); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/205-admin-groups.png` });
  await page.goto(base + "/closet"); await page.locator("a[href^='/closet/']").first().click(); await page.waitForURL(/\/closet\/.+/);
  await page.getByTestId("mirror-photo").waitFor(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/208-item-use-in-mirror.png` });
  await page.getByTestId("row-made").click(); await page.getByTestId("made-button_front").click(); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/206-item-made-with.png` });
  await ctx.close();
}
// desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(base + "/today");
  await page.getByTestId("try-on").click(); await page.getByTestId("mirror-styling").waitFor({ timeout: 20000 }); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/207-mirror-desktop.png` });
  await ctx.close();
}
await browser.close();
