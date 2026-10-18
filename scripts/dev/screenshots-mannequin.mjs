/** Dev-only: SEE IT ON on the mannequin (Jeff with no body photo; Jeff dressing Mya) on :3100 (e2e DB, mocks). */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff Mya", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage();
await page.goto(base + "/login");
await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
await page.getByTestId("enter-zip").click(); await page.getByRole("dialog").getByRole("textbox").fill("92101"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
await page.getByTestId("see-on-mannequin").waitFor(); await page.getByTestId("see-on-mannequin").scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/120-today-see-it-on.png` });
await page.getByTestId("see-on-mannequin").click(); await page.getByTestId("try-on-sheet").waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/121-mannequin-sheet.png` }); await page.keyboard.press("Escape");
// a parent dressing a minor: switch the closet to Mya
await page.getByRole("button", { name: /Jeff menu/ }).click(); await page.getByRole("option", { name: "Mya" }).click(); await page.getByRole("button", { name: /Mya menu/ }).waitFor(); await page.goto(base + "/today"); await page.waitForTimeout(800);
await page.getByTestId("see-on-mannequin").waitFor({ timeout: 30000 }); await page.getByTestId("see-on-mannequin").click(); await page.getByTestId("try-on-sheet").waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/122-mannequin-mya.png` });
await browser.close();
