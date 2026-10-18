/** Dev-only: Today after the 18 Oct feedback: plain sentence + why bullets, boards with no blank tiles, Change a piece with Remove. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-items.ts", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage(); const base = "http://localhost:3100";
await page.goto(base + "/login");
await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
await page.getByTestId("enter-zip").click(); await page.getByRole("dialog").getByRole("textbox").fill("92101"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
await page.getByTestId("why").waitFor(); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/110-today-why.png`, fullPage: true });
await page.getByTestId("swap").click(); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/111-today-change-piece.png` });
// take pieces off until two remain: the board stacks them
for (let i = 0; i < 3; i++) {
  const remove = page.getByRole("dialog").locator("[data-testid^=remove-]").first();
  if (!(await remove.count())) break;
  await remove.click(); await page.getByRole("dialog").waitFor({ state: "hidden" }); await page.waitForTimeout(600);
  await page.getByTestId("swap").click(); await page.waitForTimeout(300);
}
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/112-today-two-pieces-stacked.png` });
await browser.close();
