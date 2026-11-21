"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const pad = (n: number) => String(n).padStart(3, "0");

/** Nothing is ready to confirm yet but photos are still being tagged: wait here, refresh every 2.5s. */
export function Waiting({ working, added, total, batchId }: { working: number; added: number; total: number; batchId: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [router, batchId]);
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative h-[380px] bg-bone">
        <div className="absolute inset-x-0 top-0 flex h-14 items-center justify-between px-2">
          <Link href="/add" aria-label="Close, progress is saved" className="flex size-11 items-center justify-center text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M5 5l14 14M19 5 5 19" /></svg>
          </Link>
          <span className="mono mono-11 bg-paper px-2.5 py-1.5">{pad(added + 1)} / {pad(total)}</span>
          <span className="w-11" />
        </div>
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <span className="mono mono-11" aria-live="polite">Tagging · {working} left</span>
          <span className="mono text-graphite">The next piece will appear here</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-black/[0.12]"><div className="h-[3px] bg-ink transition-[width] duration-300" style={{ width: `${total ? Math.round((added / total) * 100) : 0}%` }} /><div aria-hidden className="absolute inset-y-0 w-1/4 animate-pulse bg-ink/40 motion-reduce:hidden" style={{ left: `${total ? Math.round((added / total) * 100) : 0}%` }} /></div>
      </div>
    </div>
  );
}
