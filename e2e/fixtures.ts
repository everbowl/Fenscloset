import { test as base, expect } from "@playwright/test";

/**
 * The suite's `test`: the same Playwright `test`, with one change to `page.goto`. A hard navigation issued while the
 * app router is still fetching (right after a sign-in redirect, a tapped link or a back control) aborts that fetch,
 * and Next.js then falls back to a full navigation to the URL it was fetching. Chromium lets the goto win; WebKit
 * reports "Navigation to … is interrupted by another navigation to …". No person navigates that fast, so every goto
 * first waits for the network to settle (capped, so a page that polls never holds a test).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
      return goto(url, options);
    };
    await use(page);
  },
});

export { expect };
