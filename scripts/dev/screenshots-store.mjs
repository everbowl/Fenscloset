/** Dev-only: screenshots of Add from a store (link + receipt) and the photo nudge on the item page. */
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
/** The mock store's picture links are not real; serve a flat swatch so the card renders as it does with a real store. */
async function swatches(page) {
  const buf = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 214, g: 196, b: 168 } } }).jpeg().toBuffer();
  await page.route(/mock\.example\/.*\.(jpg|png)/, (route) => route.fulfill({ body: buf, contentType: "image/jpeg" }));
}
async function login(page) {
  await swatches(page);
  await page.goto(base + "/login");
  await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
}
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage();
await login(page);
await page.goto(base + "/add"); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/96-add-with-store-link.png` });
await page.goto(base + "/add/store"); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/97-store-link-empty.png` });
await page.getByTestId("store-url").fill("https://mock.example/products/linen-blazer"); await page.getByTestId("lookup").click();
await page.getByTestId("product-name").waitFor(); await page.getByTestId("color-Black").click(); await page.getByTestId("size-M").click(); await page.getByRole("button", { name: "One more" }).click(); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/98-store-link-card.png`, fullPage: true });
await page.getByTestId("add-to-closet").click(); await page.getByTestId("added-strip").waitFor(); await page.waitForTimeout(300);
await page.getByTestId("tab-receipt").click();
const dir = mkdtempSync(path.join(os.tmpdir(), "fc-shots-")); const file = path.join(dir, "receipt.jpg");
writeFileSync(file, await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 250, g: 250, b: 250 } } }).jpeg().toBuffer());
await page.getByTestId("receipt-file").setInputFiles(file); await page.getByTestId("receipt-line").first().waitFor({ timeout: 20000 }); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/99-store-receipt-lines.png`, fullPage: true });
await page.getByTestId("add-receipt").click(); await page.getByTestId("added-strip").waitFor();
await page.goto(base + "/add"); await page.getByRole("link", { name: /Confirm 5 ready/ }).waitFor({ timeout: 30000 }); await page.getByRole("link", { name: /Confirm 5 ready/ }).click();
await page.getByTestId("confirm-counter").waitFor(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/100-store-confirm-card.png` });
await page.getByTestId("confirm-next").click(); await page.getByTestId("confirm-counter").waitFor(); await page.waitForTimeout(600);
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'UPDATE "Item" SET "wearCount" = 1'`, { stdio: "ignore" });
await page.goto(base + "/closet"); await page.getByTestId("item-card").first().click(); await page.getByTestId("photo-nudge").waitFor(); await page.getByTestId("photo-nudge").scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/101-item-photo-nudge.png` });
const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const dpage = await dctx.newPage(); await login(dpage);
await dpage.goto(base + "/add/store"); await dpage.getByTestId("store-url").fill("https://mock.example/products/linen-blazer"); await dpage.getByTestId("lookup").click(); await dpage.getByTestId("product-name").waitFor(); await dpage.waitForTimeout(300);
await dpage.screenshot({ path: `${out}/98-store-link-card-desktop.png` });
await browser.close();
