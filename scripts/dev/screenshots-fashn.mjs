/** Dev-only: the Mirror engine rule and the mirror in Compare (Google and FASHN side by side), app on :3100 with MOCK_TRYON + MOCK_FASHN. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import sharp from "sharp";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage();
const base = "http://localhost:3100";
await page.goto(base + "/login");
await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
// a body photo, so the mirror dresses him and not the mannequin
await page.goto(base + "/profile/body");
const buffer = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toBuffer();
await page.getByTestId("body-photo").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer });
await page.locator("[data-testid^=body-photo-]").first().waitFor();
// the rule: Compare
await page.goto(base + "/admin/rules");
await page.getByTestId("rule-mirrorEngine").scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/01-rules-mirror-engine.png` });
await page.getByLabel("Mirror engine").selectOption("compare");
await page.getByTestId("rule-mirrorEngine").getByRole("button", { name: "Save" }).click();
await page.getByTestId("rule-mirrorEngine").getByRole("button", { name: "Saved" }).waitFor();
// the mirror: both side by side
await page.goto(base + "/today");
await page.getByTestId("try-on").click();
await page.getByTestId("mirror-compare").waitFor({ timeout: 30000 }); await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/02-mirror-compare.png`, fullPage: true });
await browser.close();
console.log("shots done");
