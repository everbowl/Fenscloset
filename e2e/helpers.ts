import { execSync } from "node:child_process";
import type { Page } from "@playwright/test";

export const E2E_DB = "postgresql://postgres@localhost:5433/fenscloset_e2e";
export const JEFF_PASSWORD = "closet-rocks-2026";

/** Fresh seeded database for a spec. With jeffReady, Jeff already has a real password (skips the 0535 flow). */
export function resetAndSeed(opts: { jeffReady?: boolean } = {}) {
  const env = { ...process.env, DATABASE_URL: E2E_DB, DEV_MODE: "true", SEED_FORCE: "true" };
  execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
  execSync("npx prisma migrate deploy", { stdio: "ignore", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore", env });
  if (opts.jeffReady) execSync(`npx tsx e2e/set-password.ts jeff@everbowl.com ${JEFF_PASSWORD}`, { stdio: "ignore", env });
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(today|change-password)$/);
}
