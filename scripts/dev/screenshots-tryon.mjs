/** Dev-only: Settings try-on row, Today TRY IT ON + sheet, Shop SEE IT ON ME on :3100 (e2e DB, mocks). Phone + desktop. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import sharp from "sharp";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
const body = await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 150, g: 140, b: 130 } } }).jpeg().toBuffer();
for (const [tag, ctx] of [["phone", { ...devices["iPhone 15"] }], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  const page = await (await browser.newContext(ctx)).newPage();
  await page.goto(base + "/login"); await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
  await page.goto(base + "/profile/settings"); await page.getByTestId("tryon-toggle").waitFor();
  if (tag === "phone") { await page.getByTestId("tryon-toggle").click(); await page.waitForTimeout(600); }
  await page.screenshot({ path: `${out}/70-settings-tryon-${tag}.png`, fullPage: true });
  if (tag === "phone") { await page.goto(base + "/profile/body"); await page.getByTestId("body-photo").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: body }); await page.locator("[data-testid^=body-photo-]").first().waitFor(); }
  await page.goto(base + "/today"); await page.getByTestId("try-on").waitFor(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/71-today-tryon-${tag}.png`, fullPage: true });
  await page.getByTestId("try-on").click(); await page.getByTestId("try-on-sheet").waitFor({ timeout: 20000 }); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/72-tryon-sheet-${tag}.png` }); await page.keyboard.press("Escape");
  await page.goto(base + "/shop"); await page.getByTestId("paste-link").click(); await page.getByRole("dialog").getByRole("textbox").fill("https://mock.example/p/1"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByTestId("see-it-on-me").waitFor(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/73-shop-tryon-${tag}.png`, fullPage: true });
}
await browser.close(); console.log("done");
