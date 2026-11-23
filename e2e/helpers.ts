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
  await settle(page);
}

/**
 * Wait for the router's follow-up work after a navigation. A server action that set a cookie and redirected makes Next.js
 * refresh the new page's data right after the URL changes; a hard page.goto() inside that window aborts the fetch, and the
 * router falls back to a full navigation to the current URL, which WebKit reports as "interrupted by another navigation".
 * No person navigates that fast after a sign-in, so this is the harness waiting its turn.
 */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}
