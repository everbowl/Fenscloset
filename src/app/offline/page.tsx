import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <WifiOff className="mb-4 size-10 text-stone-400" />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="mt-2 max-w-xs text-sm text-muted">Fen&apos;s Closet needs a connection to load your closet. Anything you queued will continue when you&apos;re back online.</p>
    </main>
  );
}
