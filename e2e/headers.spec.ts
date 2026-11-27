import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => resetAndSeed({ adminReady: true }));

const EXPECTED: Record<string, RegExp> = {
  "strict-transport-security": /max-age=\d+/,
  "x-content-type-options": /^nosniff$/,
  "x-frame-options": /^DENY$/,
  "referrer-policy": /^strict-origin-when-cross-origin$/,
  "permissions-policy": /camera=\(self\).*microphone=\(\).*geolocation=\(self\)/,
  "x-robots-tag": /noindex/,
};

test("every response carries the security headers, a nonce-bound CSP (report-only for now), and never names the framework", async ({ request }) => {
  for (const path of ["/login", "/api/health", "/today"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    const h = res.headers();
    for (const [name, re] of Object.entries(EXPECTED)) expect(h[name], `${path} ${name}`).toMatch(re);
    expect(h["content-security-policy-report-only"], `${path} csp`).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(h["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy-report-only"]).toContain("report-uri /api/csp-report");
    expect(h["reporting-endpoints"], `${path} reporting-endpoints`).toMatch(/^csp="http.*\/api\/csp-report"$/);
    expect(h["x-powered-by"], `${path} x-powered-by`).toBeUndefined();
  }
  // two requests, two nonces
  const [a, b] = await Promise.all([request.get("/login"), request.get("/login")]);
  expect(a.headers()["content-security-policy-report-only"]).not.toBe(b.headers()["content-security-policy-report-only"]);
});

test("a violation report is accepted without a session and answered with no body", async ({ request }) => {
  const res = await request.post("/api/csp-report", { headers: { "content-type": "application/csp-report" }, data: JSON.stringify({ "csp-report": { "document-uri": "http://localhost:3100/login", "effective-directive": "script-src", "blocked-uri": "inline" } }) });
  expect(res.status()).toBe(204);
});

test("the sign-in page and Today load with no CSP violation reported by the browser", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content[- ]Security[- ]Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByTestId("greeting")).toBeVisible();
  await page.goto("/closet");
  await expect(page.getByRole("heading", { name: "Closet" })).toBeVisible();
  expect(violations, violations.join("\n")).toEqual([]);
});
