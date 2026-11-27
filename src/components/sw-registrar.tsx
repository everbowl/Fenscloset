"use client";

import { useEffect, useRef, useState } from "react";

const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Registers the service worker and watches for the next build. A deploy while someone is in the app must never leave dead
 * buttons (Jeff, 23 Nov 2026): the moment a new worker has installed behind an open page, a bar says "New version ready ·
 * Reload"; the tap tells the new worker to take over (skipWaiting) and the page reloads when it does. Until then the open
 * page keeps the old worker and the old build's cache (src/lib/sw-source.ts). Update checks run on every return to the app
 * and every five minutes, because register() alone looks only once per hard load and <Link> navigations never look.
 */
export function ServiceWorkerRegistrar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [reloading, setReloading] = useState(false);
  const reloaded = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let reg: ServiceWorkerRegistration | undefined;
    const reload = () => { if (reloaded.current) return; reloaded.current = true; window.location.reload(); };
    // A worker that finished installing while this page is controlled by an older one is the next build, waiting.
    const watch = (w: ServiceWorker | null) => {
      if (!w) return;
      const onState = () => { if (w.state === "installed" && sw.controller) setWaiting(w); };
      w.addEventListener("statechange", onState);
      onState();
    };
    sw.register("/sw.js", { scope: "/" }).then((r) => {
      reg = r;
      if (r.waiting) watch(r.waiting);
      r.addEventListener("updatefound", () => watch(r.installing));
    }).catch(() => {});
    // The new worker took over, here or in another tab of the app: this page's build is gone, so move onto the new one.
    sw.addEventListener("controllerchange", reload);
    const check = () => { if (document.visibilityState === "visible") reg?.update().catch(() => {}); };
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => { sw.removeEventListener("controllerchange", reload); document.removeEventListener("visibilitychange", check); clearInterval(timer); };
  }, []);

  if (!waiting) return null;
  function apply() {
    setReloading(true);
    waiting?.postMessage({ type: "skipWaiting" });
    // controllerchange reloads the page; if the worker is gone or slow, reload anyway so the tap always lands.
    setTimeout(() => { if (!reloaded.current) { reloaded.current = true; window.location.reload(); } }, 3000);
  }
  return (
    <div className="wait flex items-center justify-between gap-3" role="status" data-testid="sw-update">
      <span className="text-[14px] leading-snug">New version ready</span>
      <button type="button" onClick={apply} disabled={reloading} className="pill pill-sm shrink-0 bg-paper text-ink" data-testid="sw-update-reload">{reloading ? "Reloading…" : "Reload"}</button>
    </div>
  );
}
