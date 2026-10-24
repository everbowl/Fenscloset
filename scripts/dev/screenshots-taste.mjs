/** Dev-only: Style page (inspiration + learned taste), Fits panel rating, Today strip on :3100 (e2e DB, mocks). Phone + desktop. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import sharp from "sharp";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
const psql = (sql) => execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -v ON_ERROR_STOP=1 -c "${sql.replace(/"/g, '\\"')}"`, { stdio: "inherit" });
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env });
// learned lines + an unrated fit for yesterday (LA time)
const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })); la.setDate(la.getDate() - 1);
const yesterday = `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, "0")}-${String(la.getDate()).padStart(2, "0")}`;
psql(`WITH j AS (SELECT id FROM "Person" WHERE name='Jeff'), it AS (SELECT id, name FROM "Item" WHERE "ownerId"=(SELECT id FROM j))
INSERT INTO "LookFeedback" (id, "personId", date, kind, "itemIds", "itemId")
SELECT md5(random()::text), (SELECT id FROM j), d, 'worn'::"LookFeedbackKind", ARRAY(SELECT id FROM it ORDER BY name LIMIT 3), NULL FROM unnest(ARRAY['2026-10-10','2026-10-12','2026-10-15']) d
UNION ALL SELECT md5(random()::text), (SELECT id FROM j), d, 'passed'::"LookFeedbackKind", ARRAY(SELECT id FROM it ORDER BY name DESC LIMIT 3), NULL FROM unnest(ARRAY['2026-10-10','2026-10-12','2026-10-15','2026-10-16']) d
UNION ALL SELECT md5(random()::text), (SELECT id FROM j), d, 'swapped_out'::"LookFeedbackKind", ARRAY(SELECT id FROM it ORDER BY name LIMIT 3), (SELECT id FROM it ORDER BY name DESC LIMIT 1) FROM unnest(ARRAY['2026-10-11','2026-10-13']) d;`);
psql(`WITH j AS (SELECT id FROM "Person" WHERE name='Jeff'), f AS (INSERT INTO "Fit" (id, "personId", date, title, "createdAt", "updatedAt") VALUES ('fit_yesterday', (SELECT id FROM j), '${yesterday}', 'Dinner out', now(), now()) RETURNING id)
INSERT INTO "FitItem" ("fitId", "itemId", "sortOrder") SELECT 'fit_yesterday', id, row_number() OVER () FROM (SELECT id FROM "Item" WHERE "ownerId"=(SELECT id FROM j) ORDER BY name LIMIT 3) x;`);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
const look = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 196, g: 178, b: 140 } } }).jpeg().toBuffer();
for (const [tag, ctx] of [["phone", { ...devices["iPhone 15"] }], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  const page = await (await browser.newContext(ctx)).newPage();
  await page.goto(base + "/login"); await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
  await page.getByTestId("yesterday-strip").waitFor(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/61-today-strip-${tag}.png`, fullPage: true });
  await page.goto(base + "/profile/style"); await page.getByTestId("inspiration").waitFor();
  if (tag === "phone") { await page.getByTestId("inspiration-file").setInputFiles({ name: "look.jpg", mimeType: "image/jpeg", buffer: look }); await page.getByTestId("inspiration-tile").waitFor(); }
  await page.waitForTimeout(400); await page.screenshot({ path: `${out}/60-style-taste-${tag}.png`, fullPage: true });
  if (tag === "phone") { await page.getByTestId("inspiration-tile").first().click(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/62-inspiration-sheet-${tag}.png` }); await page.keyboard.press("Escape"); }
  await page.goto(base + "/fits"); await page.getByTestId("day-with-fit").first().click(); await page.getByTestId("rating-row").waitFor(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/63-fits-rating-${tag}.png`, fullPage: true });
}
await browser.close(); console.log("done");
