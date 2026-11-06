import { Mark } from "@/components/brand";

export const metadata = { title: "Offline" };

/** Shown by the service worker when a page can't be fetched: no connection, or the site took too long to answer. On brand, like every other screen. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center px-6 text-center">
      <Mark className="mb-6 h-10 w-auto" />
      <h1 className="serif text-[40px] leading-none">Can’t reach <em>the closet</em></h1>
      <p className="mono mt-4 text-graphite">No connection, or the site is slow to answer</p>
      <p className="mt-3 max-w-xs text-[14px] leading-snug text-graphite">Anything you queued carries on when you’re back online.</p>
      <a href="/today" className="pill pill-solid mt-8 h-[50px] px-8" data-testid="offline-retry">Try again</a>
    </main>
  );
}
