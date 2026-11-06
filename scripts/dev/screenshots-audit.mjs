/** Dev-only: the whole app, screen by screen, for a UI/UX audit (Jeff, 30 Oct 2026). Phone (iPhone 15, full page) for every route and the main sheets, desktop (1280×900) for the main screens. App on :3100 with the mock env. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff Brittney Olivia Mya && npx tsx e2e/seed-views.ts && npx tsx e2e/seed-brands.ts Jeff Everlane Vuori 'J.Crew'", { stdio: "ignore", env });
async function fixtures() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fc-audit-"));
  const files = [];
  for (const [i, [r, g, b]] of [[20, 20, 20], [200, 30, 30], [30, 60, 200]].entries()) {
    const buf = await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r, g, b } } })
      .composite([{ input: await sharp({ create: { width: 800, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), top: i * 250, left: 0 }]).jpeg().toBuffer();
    const p = path.join(dir, `piece-${i + 1}.jpg`); writeFileSync(p, buf); files.push(p);
  }
  return files;
}
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ ...devices["iPhone 15"] });
const page = await ctx.newPage();
const base = "http://localhost:3100";
const fails = [];
const step = async (name, fn, full = true) => {
  try { await fn(); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png`, fullPage: full }); }
  catch (e) { fails.push(`${name}: ${String(e).split("\n")[0]}`); try { await page.screenshot({ path: `${out}/${name}-FAILED.png` }); } catch {} }
};
const esc = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); };
const sheet = () => page.getByRole("dialog");

await step("a01-login", async () => { await page.goto(base + "/login"); });
await step("a02-forgot-password", async () => { await page.goto(base + "/forgot-password"); });
await step("a03-invite-no-token", async () => { await page.goto(base + "/invite"); });
await step("a04-offline", async () => { await page.goto(base + "/offline"); });
await page.goto(base + "/login"); await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);

await step("b01-today-no-zip", async () => { await page.goto(base + "/today"); await page.getByTestId("today").waitFor(); });
await step("b02-zip-sheet", async () => { await page.getByTestId("enter-zip").click(); await sheet().waitFor(); }, false);
await step("b03-today", async () => { await sheet().getByRole("textbox").fill("92101"); await sheet().getByRole("button", { name: "Save" }).click(); await page.getByTestId("board").first().waitFor({ timeout: 40000 }); await page.waitForTimeout(1500); });
await step("b04-check-in-sheet", async () => { await page.getByTestId("check-in").click(); await sheet().waitFor(); }, false); await esc();
await step("b05-plan-sheet", async () => { await page.getByTestId("edit-plan").click(); await sheet().waitFor(); }, false); await esc();
await step("b06-swap-sheet", async () => { await page.getByTestId("swap").click(); await sheet().waitFor(); }, false); await esc();
await step("b07-person-menu", async () => { await page.getByRole("button", { name: /Jeff menu/ }).click(); await sheet().waitFor(); }, false); await esc();
await step("b08-together", async () => { await page.goto(base + "/today/together"); await page.getByTestId("together").waitFor(); });
await step("b09-together-boards", async () => { await page.getByTestId("together-person-Brittney").click(); await page.getByTestId("together-person-Mya").click(); await page.getByTestId("mode-coordinate").click(); await page.getByTestId("dress-us").click(); await page.getByTestId("together-boards").waitFor({ timeout: 40000 }); });

await step("c01-closet", async () => { await page.goto(base + "/closet"); await page.getByTestId("item-card").first().waitFor(); });
await step("c02-closet-search-open", async () => { await page.getByRole("button", { name: "Search" }).click(); await page.getByRole("textbox", { name: "Search" }).waitFor(); }, false);
await step("c03-closet-family", async () => { await page.getByRole("button", { name: /Jeff menu/ }).click(); await page.getByRole("option", { name: "Family closet" }).click(); await page.getByRole("button", { name: /Family menu/ }).waitFor(); await page.goto(base + "/closet"); await page.waitForTimeout(500); });
try { await page.getByRole("button", { name: /Family menu/ }).click(); await page.getByRole("option", { name: /^Jeff\b/ }).click(); await page.getByRole("button", { name: /Jeff menu/ }).waitFor(); } catch (e) { fails.push("back-to-jeff: " + String(e).split("\n")[0]); await esc(); }
await step("c04-item", async () => { await page.goto(base + "/closet"); await page.getByTestId("item-card").filter({ hasText: "Black crew tee" }).click(); await page.waitForURL(/\/closet\/.+/); await page.getByRole("heading", { level: 1 }).waitFor(); });
const itemUrl = page.url();
await step("c05-item-color-sheet", async () => { await page.getByTestId("row-color").click(); await sheet().waitFor(); }, false); await esc();
await step("c06-item-closets-sheet", async () => { await page.getByTestId("row-closets").click(); await sheet().waitFor(); }, false); await esc();
await step("c07-go-with", async () => { await page.getByTestId("go-with").click(); await page.getByTestId("go-with-result").waitFor({ timeout: 45000 }); });
await step("c08-clean-out", async () => { await page.goto(base + "/closet/clean-out"); await page.waitForTimeout(500); });
await step("c09-mirror-complete", async () => { await page.goto(base + "/closet"); await page.getByTestId("closet-mirror").click(); await page.getByTestId("item-card").filter({ hasText: "Black crew tee" }).click(); await page.getByTestId("see-picked").click(); await page.getByTestId("complete-look").waitFor({ timeout: 20000 }); }, false);
await step("c10-mirror-picture", async () => { while (await page.getByTestId("complete-skip").isVisible()) await page.getByTestId("complete-skip").click(); await page.getByTestId("try-on-sheet").waitFor({ timeout: 40000 }); await page.waitForTimeout(2000); }, false);
await esc(); await esc();

await step("d01-add", async () => { await page.goto(base + "/add"); await page.getByTestId("add-doors").waitFor(); });
await step("d02-add-photo-tips", async () => { await page.getByTestId("door-photo").click(); await page.getByTestId("photo-tips").waitFor(); });
await step("d03-add-store", async () => { await page.goto(base + "/add/store"); await page.waitForTimeout(500); });
await step("d04-batch", async () => { await page.goto(base + "/add"); await page.getByTestId("door-photo").click(); await page.getByTestId("pick-photos").setInputFiles(await fixtures()); await page.getByRole("link", { name: /Confirm 3 ready/ }).waitFor({ timeout: 90000 }); });
await step("d05-confirm", async () => { await page.getByRole("link", { name: /Confirm 3 ready/ }).click(); await page.getByTestId("confirm-counter").waitFor(); });
await step("d06-confirm-brand-sheet", async () => { await page.getByTestId("row-brand").click(); await sheet().waitFor(); }, false); await esc();

await step("e01-shop-empty", async () => { await page.goto(base + "/shop"); await page.getByTestId("shop-empty").waitFor(); });
await step("e02-shop-link-sheet", async () => { await page.getByTestId("paste-link").click(); await sheet().waitFor(); }, false);
await step("e03-shop-thinking", async () => { await sheet().getByRole("textbox").fill("https://mock.example/p/1"); await sheet().getByRole("button", { name: "Save" }).click(); await page.getByTestId("shop-thinking").waitFor(); }, false);
await step("e04-shop-result", async () => { await page.getByTestId("shop-result").waitFor({ timeout: 40000 }); await page.getByTestId("products").waitFor({ timeout: 40000 }).catch(() => {}); await page.waitForTimeout(1000); });
await step("e05-shop-for-sheet", async () => { await page.getByTestId("shop-for").click(); await sheet().waitFor(); }, false); await esc();
await step("e06-looking-for-empty", async () => { await page.goto(base + "/shop/looking-for"); await page.getByTestId("looking-for-empty").waitFor(); });
await step("e07-want-sheet", async () => { await page.getByTestId("want-add").click(); await page.getByTestId("want-text").waitFor(); }, false);
await step("e08-looking-for-list", async () => { await page.getByTestId("want-text").fill("navy cashmere crewneck under $100"); await page.getByTestId("want-save").click(); await page.getByTestId("want-new").waitFor({ timeout: 40000 }); });
await step("e09-want-detail", async () => { await page.getByTestId("want-row").click(); await page.getByTestId("want-title").waitFor(); });
await step("e10-shop-with-rows", async () => { await page.goto(base + "/shop"); await page.getByTestId("brand-feed").waitFor({ timeout: 40000 }); await page.waitForTimeout(4000); });

await step("f01-fits", async () => { await page.goto(base + "/fits"); await page.getByTestId("fits").waitFor(); });
await step("f02-fits-save-sheet", async () => { await page.getByTestId("save-the-fit").click(); await sheet().waitFor(); }, false); await esc();

for (const p of ["profile", "profile/body", "profile/brands", "profile/style", "profile/settings", "admin/people", "admin/lists", "admin/lists/color", "admin/lists/category", "admin/lists/size", "admin/rules", "help", "change-password"]) {
  await step("g-" + p.replace(/\//g, "-"), async () => { await page.goto(base + "/" + p); await page.waitForTimeout(500); });
}
await step("g-admin-person", async () => { await page.goto(base + "/admin/people"); await page.locator('a[href^="/admin/people/"]').first().click(); await page.waitForURL(/admin\/people\/.+/); });
await step("g-admin-add-person-sheet", async () => { await page.goto(base + "/admin/people"); await page.getByRole("button", { name: "Add person" }).click(); await sheet().waitFor(); }, false); await esc();
await step("g-help-topic", async () => { await page.goto(base + "/help"); await page.locator('a[href^="/help/"]').first().click(); await page.waitForURL(/help\/.+/); });

const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: await ctx.storageState() });
const d = await desk.newPage();
const dstep = async (name, url, full = true) => { try { await d.goto(base + url); await d.waitForTimeout(1200); await d.screenshot({ path: `${out}/${name}.png`, fullPage: full }); } catch (e) { fails.push(`${name}: ${String(e).split("\n")[0]}`); } };
await dstep("z01-desk-today", "/today"); await dstep("z02-desk-closet", "/closet"); await dstep("z03-desk-item", itemUrl.replace(base, "")); await dstep("z04-desk-add", "/add");
await dstep("z05-desk-shop", "/shop"); await dstep("z06-desk-looking-for", "/shop/looking-for"); await dstep("z07-desk-fits", "/fits"); await dstep("z08-desk-profile", "/profile");
await dstep("z09-desk-lists-color", "/admin/lists/color"); await dstep("z10-desk-rules", "/admin/rules"); await dstep("z11-desk-help", "/help");
const anon = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await anon.goto(base + "/login"); await anon.waitForTimeout(800); await anon.screenshot({ path: `${out}/z12-desk-login.png` });
await browser.close();
console.log(fails.length ? "FAILED STEPS:\n" + fails.join("\n") : "all steps ok");
