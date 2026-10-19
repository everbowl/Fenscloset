/** Dev-only: Body page with front/side/back slots, the Today outfit stack, and the mirror from behind, on :3100 (e2e DB, mocks). */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import sharp from "sharp";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage();
await page.goto(base + "/login");
await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
await page.getByTestId("enter-zip").click(); await page.getByRole("dialog").getByRole("textbox").fill("92101"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
await page.getByTestId("outfit-stack").first().waitFor(); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/160-today-outfit-stack.png` });
await page.goto(base + "/profile/settings"); await page.getByTestId("tryon-toggle").click(); await page.waitForTimeout(400);
await page.goto(base + "/profile/body"); await page.getByTestId("add-body-photo-front").waitFor(); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/161-body-three-slots.png`, fullPage: true });
const body = (tone) => sharp({ create: { width: 300, height: 400, channels: 3, background: { r: tone, g: tone - 10, b: tone - 20 } } }).jpeg().toBuffer();
for (const [v, tone] of [["front", 120], ["back", 150], ["left", 135], ["right", 140]]) {
  await page.getByTestId(`add-body-photo-${v}`).click(); await page.getByTestId("photo-shared").click();
  await page.getByTestId("body-photo").setInputFiles({ name: `${v}.jpg`, mimeType: "image/jpeg", buffer: await body(tone) });
  await page.locator(`[data-testid^=body-photo-][data-view=${v}]`).waitFor();
}
await page.waitForTimeout(300); await page.screenshot({ path: `${out}/162-body-front-back.png`, fullPage: true });
await page.goto(base + "/today"); await page.getByTestId("try-on").waitFor(); await page.getByTestId("try-on").click();
await page.getByTestId("try-on-sheet").waitFor({ timeout: 20000 }); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/164-mirror-choices.png` }); await page.getByTestId("mirror-back").click(); await page.getByTestId("try-on-sheet").getByText(/from behind/).first().waitFor({ timeout: 20000 }); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/163-mirror-from-behind.png` });
await browser.close();
