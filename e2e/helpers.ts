import { execSync } from "node:child_process";

export const E2E_DB = "postgresql://postgres@localhost:5433/fenscloset_e2e";

/** Fresh seeded database for a spec. */
export function resetAndSeed() {
  const env = { ...process.env, DATABASE_URL: E2E_DB, DEV_MODE: "true" };
  execSync(`psql -h localhost -p 5433 -U postgres -d fenscloset_e2e -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: "ignore" });
  execSync("npx prisma migrate deploy", { stdio: "ignore", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore", env });
}
