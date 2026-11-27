/**
 * The service worker, as text: src/app/sw.js/route.ts serves it with a version per build.
 *
 * What it promises (review F A1, A2, A8–A11; Jeff, 23 Nov 2026: a deploy while someone is in the app must never leave
 * dead buttons):
 * - A new worker installs and then WAITS. It never calls skipWaiting() or clients.claim() on its own, so an open page keeps
 *   the worker, and the cache, of the build that served it until the person taps Reload on the "New version ready" bar
 *   (src/components/sw-registrar.tsx posts {type:"skipWaiting"}). The old build's cache goes only on activation, after that tap.
 * - Navigations are network-first with an 8 s deadline: a dead or hung server shows the offline page, never a white screen.
 * - The offline page is precached with the CSS and JS it links to, so it renders styled before any page of that build has loaded.
 * - Photos (/api/photo/*) are cache-first in a bounded cache. {type:"logout"} empties it: the Cache API is per origin, not per
 *   person, and a shared phone must never serve one member's photo to the next.
 */
export const SW_SOURCE = `/* Fen's Closet service worker: offline fallback, static assets, photos. Pages stay network-first. A new version waits for the person's Reload. */
const VERSION = "v1";
const STATIC = "fc-static-" + VERSION;
const PHOTOS = "fc-photos-v1";
const PHOTO_LIMIT = 300;
const OFFLINE_URL = "/offline";
const NAV_DEADLINE_MS = 8000;

self.addEventListener("install", (event) => {
  // No skipWaiting(): this worker waits until the person taps Reload (the page posts skipWaiting), so the open page keeps its own build's chunks.
  event.waitUntil(precache());
});

async function precache() {
  const cache = await caches.open(STATIC);
  const res = await fetch(OFFLINE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("offline page answered " + res.status);
  const html = await res.clone().text();
  await cache.put(OFFLINE_URL, res);
  // The offline page's own CSS and JS, so it renders styled even before a page of this build has loaded.
  const assets = new Set(["/icons/icon-192.png"]);
  const link = new RegExp('(?:href|src)="([^"]*/_next/static/[^"]+)"', "g");
  for (const m of html.matchAll(link)) assets.add(m[1].replace(/&amp;/g, "&"));
  await Promise.all([...assets].map(async (u) => {
    try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch {}
  }));
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Only reached once the person accepted the new version (or no page was open): the old build's cache can go now.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("fc-static-") && k !== STATIC).map((k) => caches.delete(k)));
    // Let the browser start a navigation's request while this worker is still booting (iOS evicts workers often).
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    // No clients.claim(): pages the old worker controls stay with it until they reload.
  })());
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "skipWaiting") self.skipWaiting();
  // Signing out: photos must not outlive the session on a shared phone.
  if (type === "logout") event.waitUntil(caches.delete(PHOTOS));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build assets and icons: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) { event.respondWith(cacheFirst(req)); return; }
  if (url.pathname.startsWith("/api/photo/")) { event.respondWith(photo(event)); return; }
  if (req.mode === "navigate") event.respondWith(navigate(event));
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Photos: a key's bytes never change (src/app/api/photo), so cache-first; bounded so a big closet cannot fill the phone.
async function photo(event) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  // Only a real image: a signed-out request comes back as the login page (200, HTML) and must not be kept under the photo's URL.
  if (res.ok && (res.headers.get("content-type") || "").startsWith("image/")) {
    event.waitUntil(cache.put(event.request, res.clone()).then(() => trim(cache)));
  }
  return res;
}

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - PHOTO_LIMIT;
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((k) => cache.delete(k)));
}

// Navigations: the network, with a deadline. Dead or slow, the offline page says so; a white screen never does.
async function navigate(event) {
  const offline = () => caches.match(OFFLINE_URL);
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve("slow"), NAV_DEADLINE_MS); });
  const net = (async () => (await event.preloadResponse) || fetch(event.request))();
  net.catch(() => {});
  try {
    const first = await Promise.race([net, deadline]);
    if (first !== "slow") { clearTimeout(timer); return first; }
    const page = await offline();
    return page || (await net);
  } catch (e) {
    clearTimeout(timer);
    const page = await offline();
    if (page) return page;
    throw e;
  }
}
`;

/** The worker's version: Railway's commit, else the build id next.config.ts fixes once per build. Never the clock, which gave every restart and every replica a version of its own and made phones reinstall the worker on each visit. */
export function swVersion(env: { sha?: string; build?: string }): string {
  return (env.sha || env.build || "dev").slice(0, 12);
}

/** The worker's source with its version written in. */
export function swScript(version: string): string {
  return SW_SOURCE.replace('const VERSION = "v1";', `const VERSION = "${version}";`);
}
