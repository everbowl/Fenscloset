/** Dev-only: screenshots of My brands & sizes (profile) and the confirm card's brand pills + "More photos?" ask. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
async function login(page) {
  await page.goto(base + "/login");
  await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
}
async function addBrand(page, name, size, url) {
  await page.getByTestId("add-my-brand").click();
  await page.getByRole("dialog").getByRole("option", { name: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b") }).click();
  await page.getByTestId("my-brand-size").fill(size); if (url) await page.getByTestId("my-brand-url").fill(url);
  await page.getByTestId("save-my-brand").click(); await page.getByTestId("my-brands").getByText(name, { exact: true }).waitFor();
}
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage();
await login(page);
await page.goto(base + "/profile/brands"); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/113-my-brands-empty.png` });
await addBrand(page, "Lululemon", "L", "shop.lululemon.com");
await addBrand(page, "Vuori", "L", "vuoriclothing.com");
await addBrand(page, "Nike", "11", "");
await page.getByTestId("add-my-brand").click(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/114-my-brands-pick.png` });
await page.getByRole("dialog").getByRole("option", { name: "Levi's" }).click(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/115-my-brands-size-link.png` });
await page.getByTestId("my-brand-size").fill("32"); await page.getByTestId("my-brand-url").fill("levi.com"); await page.getByTestId("save-my-brand").click();
await page.getByTestId("my-brands").getByText("Levi's", { exact: true }).waitFor(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/116-my-brands-list.png`, fullPage: true });
// a fresh photo → confirm card with the pills and the "More photos?" ask
const dir = mkdtempSync(path.join(os.tmpdir(), "fc-shots-")); const file = path.join(dir, "tee.jpg");
writeFileSync(file, await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r: 24, g: 28, b: 40 } } })
  .composite([{ input: await sharp({ create: { width: 800, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), top: 0, left: 0 }]).jpeg().toBuffer());
await page.goto(base + "/add"); await page.getByTestId("pick-photos").setInputFiles(file);
await page.getByRole("link", { name: /Confirm 1 ready/ }).waitFor({ timeout: 30000 }); await page.getByRole("link", { name: /Confirm 1 ready/ }).click();
await page.getByTestId("my-brand-pills").waitFor(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/117-confirm-brand-pills.png`, fullPage: true });
await page.getByTestId("my-brand-pills").getByRole("button", { name: "Lululemon · L" }).click(); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/118-confirm-brand-picked.png`, fullPage: true });
await page.getByTestId("confirm-next").click(); await page.getByRole("heading", { name: /All done/ }).waitFor();
await page.goto(base + "/closet"); await page.getByTestId("item-card").first().click(); await page.getByRole("button", { name: /^Link/ }).waitFor(); await page.getByRole("button", { name: /^Link/ }).scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/119-item-with-brand-link.png` });
await browser.close();
