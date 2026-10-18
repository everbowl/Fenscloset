/** Dev-only: seeds the e2e DB, drives the app on :3100, and writes screenshots to the given folder. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage();
const base = "http://localhost:3100";
await page.goto(base + "/login"); await page.screenshot({ path: `${out}/login.png` });
await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("0535");
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/change-password/);
await page.screenshot({ path: `${out}/change.png` });
await page.getByLabel("New password").fill("closet-rocks-2026"); await page.getByLabel("Type it again").fill("closet-rocks-2026");
await page.getByRole("button", { name: "Save new password" }).click(); await page.waitForURL(/today/);
await page.screenshot({ path: `${out}/today.png` });
for (const p of ["closet", "fits", "profile", "admin/people", "admin/lists", "admin/lists/color", "admin/rules", "forgot-password"]) {
  await page.goto(base + "/" + p); await page.screenshot({ path: `${out}/${p.replace(/\//g, "-")}.png` });
}
await page.goto(base + "/today"); await page.getByRole("button", { name: /menu/ }).click(); await page.screenshot({ path: `${out}/menu.png` });
await page.goto(base + "/admin/people"); await page.getByRole("button", { name: "Add person" }).click(); await page.screenshot({ path: `${out}/admin-invite.png` });
const desk = await (await browser.newContext({ ...devices["Desktop Chrome"], storageState: await ctx.storageState() })).newPage();
await desk.goto(base + "/today"); await desk.screenshot({ path: `${out}/today-desktop.png` });
await browser.close();
console.log("done");
