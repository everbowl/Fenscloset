import { expect, test } from "@playwright/test";
import { DEV_ADMIN_EMAIL } from "../src/lib/auth/dev-mode";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });

test("PWA manifest is installable", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.id).toBe("/");
  expect(m.name).toBe("Fen's Closet");
  expect(m.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(await sw.text()).not.toContain('VERSION = "v1"'); // versioned per build
  const icon = await request.get("/icons/icon-192.png");
  expect(icon.ok()).toBe(true);
});

test("offline page, health check and the security headers respond", async ({ request }) => {
  const offline = await request.get("/offline");
  expect(offline.ok()).toBe(true);
  expect(offline.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(offline.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(offline.headers()["x-powered-by"]).toBeUndefined();
  expect((await (await request.get("/api/health")).json()).ok).toBe(true);
});

test.describe("the shell, signed in", () => {
  test.beforeAll(() => { resetAndSeed({ jeffReady: true }); });

  /** The page that registers the worker is not controlled by it until its next navigation; these tests need a controlled page. */
  async function signInUnderTheWorker(page: import("@playwright/test").Page) {
    await loginAs(page, DEV_ADMIN_EMAIL, JEFF_PASSWORD);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.goto("/today");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  }

  test("the tab bar marks the current screen, the + included", async ({ page }) => {
    await loginAs(page, DEV_ADMIN_EMAIL, JEFF_PASSWORD);
    const nav = page.getByRole("navigation", { name: "Main" });
    await page.goto("/closet");
    await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
    await expect(nav.locator("[aria-current=page]")).toContainText("Closet");
    await page.goto("/add");
    await expect(nav.locator("[aria-current=page]")).toHaveAttribute("aria-label", "Add clothes");
  });

  test("a toast shows, can be tapped away, and otherwise leaves on its own", async ({ page }) => {
    await loginAs(page, DEV_ADMIN_EMAIL, JEFF_PASSWORD);
    await page.goto("/admin/people");
    await page.getByRole("link", { name: /Mya/ }).click();
    // a parent toggle on a minor's page answers with a toast (the Details fields say "✓ Saved" inline instead, review A I1)
    const brittney = page.getByRole("checkbox", { name: /Brittney/ });
    await brittney.uncheck();
    const toast = page.getByTestId("toast-ok");
    await expect(toast).toContainText("Parents updated");
    await toast.click();
    await expect(toast).toHaveCount(0);
    await brittney.check();
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 6000 }); // 4 s for a plain success
  });

  test("with no connection a page shows the offline screen, not a white page", async ({ page, context, browserName }) => {
    test.skip(browserName === "webkit", "Playwright's offline mode does not reach the worker on WebKit");
    await signInUnderTheWorker(page);
    await context.setOffline(true);
    await page.goto("/fits").catch(() => {});
    await expect(page.getByTestId("offline-retry")).toBeVisible();
    await context.setOffline(false);
  });

  test("a new build behind an open page shows the reload bar, and Reload moves the page onto it", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "Playwright cannot drive the worker on WebKit");
    await signInUnderTheWorker(page);
    await expect(page.getByTestId("sw-update")).toHaveCount(0);
    // A second script URL on the same scope is a new version: it installs and waits behind the open page, as a deploy does.
    await page.evaluate(() => navigator.serviceWorker.register("/sw.js?v=next", { scope: "/" }));
    await expect(page.getByTestId("sw-update")).toContainText("New version ready");
    await Promise.all([page.waitForEvent("load"), page.getByTestId("sw-update-reload").click()]);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).toContain("v=next");
  });
});
