import { config } from "dotenv";
config({ path: ".env.test", override: true });
// Several suites may run at once (one per worker on a branch): TEST_DATABASE_URL points a run at its own database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
import { beforeAll } from "vitest";
process.env.SEED_FORCE = "true"; // tests re-seed on purpose
import { execSync } from "node:child_process";

beforeAll(() => {
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env } });
});
