/** Dev-only: Phase 2 profile screens on :3100 (e2e DB). */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026", { stdio: "ignore", env });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await (await browser.newContext({ ...devices["iPhone 15"] })).newPage();
const base = "http://localhost:3100";
await page.goto(base + "/login");
await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
await page.goto(base + "/profile/body");
for (const [id, v] of [["waist", "32"], ["height", "70"], ["shoe-size", "10.5"]]) {
  await page.getByTestId(`measure-${id}`).click(); await page.getByRole("dialog").getByRole("textbox").fill(v); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(400);
}
await page.getByTestId("add-size").click(); await page.getByRole("dialog").getByLabel("Size").fill("L"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(500);
await page.goto(base + "/profile"); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/11-profile-hub.png` });
await page.goto(base + "/profile/body"); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/12-body-profile.png`, fullPage: true });
await page.getByTestId("measure-hips").click(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/12b-body-measure-sheet.png` }); await page.keyboard.press("Escape");
await page.goto(base + "/profile/style"); await page.getByTestId("row-loved").click(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/13b-style-colour-picker.png` });
await page.getByRole("dialog").getByRole("option", { name: "Navy" }).click(); await page.getByRole("dialog").getByRole("option", { name: "Cream" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Done" }).click(); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/13-style-profile.png` });
await page.goto(base + "/profile/brands"); await page.getByTestId("edit-brands").click(); await page.getByRole("dialog").getByRole("option", { name: "Nike" }).click(); await page.getByRole("dialog").getByRole("option", { name: "Lululemon" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Done" }).click(); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/14-brands-stores.png` });
await page.goto(base + "/profile/settings"); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/15-settings-privacy.png` });
await page.getByTestId("row-body-viewers").click(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/15b-settings-body-viewers.png` }); await page.keyboard.press("Escape");
await page.getByRole("button", { name: /Jeff menu/ }).click(); await page.getByRole("option", { name: "Mya" }).click(); await page.getByRole("button", { name: /Mya menu/ }).waitFor();
await page.goto(base + "/profile/body"); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/16-mya-body-as-parent.png`, fullPage: true });
await page.goto(base + "/admin/people"); await page.getByRole("link", { name: /Mya/ }).click(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/17-admin-mya-body-photos.png`, fullPage: true });
await browser.close();
console.log("done");
