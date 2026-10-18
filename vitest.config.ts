import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    env: { NODE_ENV: "test" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
