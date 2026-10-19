/** Dev-only: Today after the visibility rework — weather block, Look in the mirror, Together/clean-out cards — on :3100 (e2e DB, mocks). */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff Mya", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
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
  await page.getByTestId("enter-zip").click(); await page.getByRole("dialog").getByRole("textbox").fill("92101"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByTestId("weather-block").waitFor(); await page.getByTestId("mirror").waitFor(); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/130-today-top.png` });
  await page.screenshot({ path: `${out}/131-today-full.png`, fullPage: true });
  await page.getByTestId("mirror").scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/132-today-mirror.png` });
  await page.getByTestId("see-on-mannequin").click(); await page.getByTestId("try-on-sheet").waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/133-mirror-sheet.png` });
  await ctx.close();
}
// desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  await page.getByTestId("mirror").waitFor(); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/134-today-desktop.png` });
  await page.screenshot({ path: `${out}/135-today-desktop-full.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
