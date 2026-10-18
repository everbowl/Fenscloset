/** Dev-only: Style page with learned taste lines on :3100 (e2e DB, mocks). Phone + desktop. */
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
const out = process.argv[2];
const env = { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SEED_FORCE: "true", MOCK_S3: "true" };
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
execSync("npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx e2e/set-password.ts jeff@everbowl.com closet-rocks-2026 && npx tsx e2e/seed-closets.ts Jeff", { stdio: "ignore", env });
// three days of worn / passed / swapped feedback for Jeff
execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -v ON_ERROR_STOP=1 -c "
WITH j AS (SELECT id FROM \\"Person\\" WHERE name='Jeff'), it AS (SELECT id, name FROM \\"Item\\" WHERE \\"ownerId\\"=(SELECT id FROM j))
INSERT INTO \\"LookFeedback\\" (id, \\"personId\\", date, kind, \\"itemIds\\", \\"itemId\\")
SELECT md5(random()::text), (SELECT id FROM j), d, 'worn'::\\"LookFeedbackKind\\", ARRAY(SELECT id FROM it ORDER BY name LIMIT 3), NULL FROM unnest(ARRAY['2026-10-10','2026-10-12','2026-10-15']) d
UNION ALL SELECT md5(random()::text), (SELECT id FROM j), d, 'passed'::\\"LookFeedbackKind\\", ARRAY(SELECT id FROM it ORDER BY name DESC LIMIT 3), NULL FROM unnest(ARRAY['2026-10-10','2026-10-12','2026-10-15','2026-10-16']) d
UNION ALL SELECT md5(random()::text), (SELECT id FROM j), d, 'swapped_out'::\\"LookFeedbackKind\\", ARRAY(SELECT id FROM it ORDER BY name LIMIT 3), (SELECT id FROM it ORDER BY name DESC LIMIT 1) FROM unnest(ARRAY['2026-10-11','2026-10-13']) d;"`, { stdio: "inherit" });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const base = "http://localhost:3100";
for (const [tag, ctx] of [["phone", { ...devices["iPhone 15"] }], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  const page = await (await browser.newContext(ctx)).newPage();
  await page.goto(base + "/login"); await page.getByLabel("Email").fill("jeff@everbowl.com"); await page.getByLabel("Password").fill("closet-rocks-2026");
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/today/);
  await page.goto(base + "/profile/style"); await page.getByTestId("taste-memory").waitFor(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/60-style-taste-${tag}.png`, fullPage: true });
}
await browser.close(); console.log("done");
