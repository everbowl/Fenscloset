import { config } from "dotenv";
config({ path: ".env.test", override: true });
import { beforeAll } from "vitest";
process.env.SEED_FORCE = "true"; // tests re-seed on purpose
import { execSync } from "node:child_process";

beforeAll(() => {
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env } });
});
