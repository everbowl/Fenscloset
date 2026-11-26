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
      for (let attempt = 0; ; attempt++) {
        await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
        try { return await goto(url, options); }
        catch (e) {
          // The router's fallback navigation won the race (Today polling for its looks can keep the network busy past
          // the cap): let it land, then go where the test meant to. Twice, then the error is real.
          if (attempt < 2 && /interrupted by another navigation|Frame load interrupted/.test((e as Error).message)) {
            await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
            continue;
          }
          throw e;
        }
      }
    };
    await use(page);
  },
});

export { expect };
