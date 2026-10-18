/** Dev-only: desktop (1280×900) views of the main screens on :3100 (e2e DB, mocks). Run after screenshots-phase3.mjs seeded the data. */
import { chromium } from "@playwright/test";
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const base = "http://localhost:3100";
const shot = async (name, full = false) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png`, fullPage: full }); };
await page.goto(base + "/login");
await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
await page.goto(base + "/today"); await page.getByTestId("today").waitFor(); await shot("d1-today", true);
await page.goto(base + "/closet"); await page.getByTestId("item-card").first().waitFor(); await shot("d2-closet", true);
await page.getByTestId("item-card").first().click(); await page.waitForURL(/\/closet\//); await shot("d3-item", true);
await page.goto(base + "/fits"); await page.getByTestId("fits").waitFor(); await shot("d4-fits", true);
await page.goto(base + "/today/together"); await page.getByTestId("together").waitFor(); await shot("d5-together", true);
await page.goto(base + "/profile"); await shot("d6-profile", true);
await browser.close();
console.log("done");
