import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

/** Shown by the service worker when a page can't be fetched: no connection, or the site took too long to answer. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <WifiOff className="mb-4 size-10 text-stone-400" />
      <h1 className="text-xl font-semibold">Can&apos;t reach Fen&apos;s Closet</h1>
      <p className="mt-2 max-w-xs text-sm text-muted">No connection, or the site took too long to answer. Anything you queued will continue when you&apos;re back online.</p>
      <a href="/today" className="pill pill-solid mt-6 h-[50px] px-6" data-testid="offline-retry">Try again</a>
    </main>
  );
}
