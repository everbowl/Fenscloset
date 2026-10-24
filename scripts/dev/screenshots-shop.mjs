/** Dev-only: Shop screen on :3100 (e2e DB, mocks). Phone + desktop. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
for (const [tag, ctx] of [["phone", { ...devices["iPhone 15"] }], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  const page = await (await browser.newContext(ctx)).newPage();
  await page.goto(base + "/login"); await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
  await page.goto(base + "/shop"); await page.getByTestId("shop").waitFor(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/40-shop-empty-${tag}.png`, fullPage: true });
  await page.getByTestId("paste-link").click(); await page.getByRole("dialog").getByRole("textbox").fill("https://mock.example/p/1"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByTestId("shop-result").waitFor(); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/41-shop-result-${tag}.png`, fullPage: true });
  await page.getByTestId("shop-for").click(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/42-shop-for-sheet-${tag}.png` });
  // Mya's closet is empty → Bottoms missing → product row (MOCK_SERPER)
  await page.getByRole("dialog").getByRole("option", { name: "Mya" }).click(); await page.waitForURL(/for=/);
  await page.getByTestId("paste-link").click(); await page.getByRole("dialog").getByRole("textbox").fill("https://mock.example/p/1"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByTestId("products").waitFor(); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/43-shop-products-${tag}.png`, fullPage: true });
}
await browser.close(); console.log("done");
