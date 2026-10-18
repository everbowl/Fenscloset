/** Dev-only: Help grid + topic pages on :3100 (e2e DB, mocks). Phone + desktop. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
for (const [tag, ctx] of [["phone", { ...devices["iPhone 15"] }], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  const page = await (await browser.newContext(ctx)).newPage();
  await page.goto(base + "/login"); await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
  await page.goto(base + "/help"); await page.getByTestId("help").waitFor(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/52-help-grid-${tag}.png`, fullPage: true });
  for (const slug of ["add", "today", "shop"]) {
    await page.goto(base + "/help/" + slug); await page.getByTestId("help-topic").waitFor(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/53-help-${slug}-${tag}.png`, fullPage: true });
  }
}
await browser.close(); console.log("done");
