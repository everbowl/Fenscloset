/** Dev-only: the closet's pick mode → mirror, "See it on me" on a piece, the mirror's progress strip and body-photo row — on :3100 (e2e DB, mocks). */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import sharp from "sharp";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-items.ts", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
const body = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 196, g: 178, b: 160 } } }).jpeg().toBuffer();
async function login(page) {
  await page.goto(base + "/login");
  await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
}
// phone
{
  const ctx = await browser.newContext({ ...devices["iPhone 15"] });
  const page = await ctx.newPage();
  await login(page);
  // no body photo yet: the closet offers the mannequin, and the mirror offers to add the photo right there
  await page.goto(base + "/closet"); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/300-closet-mirror-button.png` });
  await page.getByTestId("closet-mirror").click();
  await page.getByTestId("item-card").filter({ hasText: "White crew tee" }).click();
  await page.getByTestId("item-card").filter({ hasText: "Dark jeans" }).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/301-closet-picked.png` });
  await page.getByTestId("see-picked").click();
  await page.getByTestId("try-on-sheet").waitFor({ timeout: 20000 }); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/302-closet-mirror-mannequin.png` });
  await page.keyboard.press("Escape");
  // with a body photo: on you, retake right in the mirror
  await page.goto(base + "/profile/body"); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/303-body-tip.png` });
  await page.getByTestId("add-body-photo-front").click(); await page.getByTestId("photo-shared").click();
  await page.getByTestId("body-photo").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: body });
  await page.locator("[data-testid^=body-photo-]").first().waitFor();
  await page.goto(base + "/closet");
  await page.getByTestId("closet-mirror").click();
  await page.getByTestId("item-card").filter({ hasText: "White crew tee" }).click();
  await page.getByTestId("see-picked").click();
  await page.getByTestId("try-on-sheet").waitFor({ timeout: 20000 }); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/304-closet-mirror-on-me.png` });
  await page.getByTestId("mirror-photo-row").scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/305-mirror-photo-row.png` });
  await page.keyboard.press("Escape");
  await page.getByTestId("pick-cancel").click();
  await page.getByTestId("item-card").filter({ hasText: "Dark jeans" }).click(); await page.waitForURL(/\/closet\/.+/); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/306-item-see-it-on-me.png` });
  await ctx.close();
}
// desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(base + "/closet");
  await page.getByTestId("closet-mirror").click();
  await page.getByTestId("item-card").filter({ hasText: "White crew tee" }).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/307-closet-picked-desktop.png` });
  await ctx.close();
}
await browser.close();
