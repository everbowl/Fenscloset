import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // The container ships Chromium at a fixed path; locally Playwright's own download is used.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"], browserName: "chromium", isMobile: true, hasTouch: true } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run build >/dev/null 2>&1 && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", DEV_MODE: "true", SESSION_SECRET: "e2e", APP_URL: `http://localhost:${PORT}`, MOCK_S3: "true", MOCK_AI: "true", MOCK_WEATHER: "true", MOCK_GOOGLE: "true", MOCK_FETCH: "true", MOCK_SERPER: "true", MOCK_TRYON: "true", MOCK_GOOGLE_IMAGE: "true", MOCK_FASHN: "true", MOCK_KLING: "true", MOCK_SHOP_SLOW_MS: "700", UNTIDY_ON_START: "false", WANTS_ON_START: "false" },
  },
});
