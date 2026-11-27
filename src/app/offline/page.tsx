import { Mark } from "@/components/brand";

export const metadata = { title: "Offline" };

/** Shown by the service worker when a page can't be fetched: no connection, or the site took longer than 8 s to answer (src/lib/sw-source.ts). On brand, like every other screen. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center px-6 text-center">
      <Mark className="mb-6 h-10 w-auto" />
      <h1 className="title">Can’t reach the closet</h1>
      <p className="note mt-4">No connection, or the site is slow to answer.</p>
      <p className="caption mt-3 max-w-xs">Anything you queued carries on when you’re back online.</p>
      <a href="/today" className="pill pill-solid mt-8 h-[50px] px-8" data-testid="offline-retry">Try again</a>
    </main>
  );
}
