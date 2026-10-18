import { config } from "dotenv";
config({ path: ".env.test", override: true });
import { beforeAll } from "vitest";
import { execSync } from "node:child_process";

beforeAll(() => {
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env } });
});
