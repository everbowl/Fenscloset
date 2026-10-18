import { expect, test } from "@playwright/test";

test("PWA manifest is installable", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.name).toBe("Fen's Closet");
  expect(m.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  const icon = await request.get("/icons/icon-192.png");
  expect(icon.ok()).toBe(true);
});

test("offline page and health check respond", async ({ request }) => {
  expect((await request.get("/offline")).ok()).toBe(true);
  expect((await (await request.get("/api/health")).json()).ok).toBe(true);
});
