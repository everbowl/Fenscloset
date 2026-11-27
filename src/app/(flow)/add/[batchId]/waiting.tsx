"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useImportQueue } from "@/components/import-queue-provider";
import { useNow } from "@/components/items/use-now";
import { isTakingLong } from "@/lib/import/timing";
import { retryEntries } from "@/app/(app)/add/add-screen";
import { toast } from "@/components/ui/toast";
import { skipEntryAction } from "./actions";

const pad = (n: number) => String(n).padStart(3, "0");

/**
 * Nothing is ready to review yet but photos are still being tagged: wait here. The root provider is the one poller
 * (review B B20); this screen re-renders the page only when the batch moves. Past a minute on the same piece it stops
 * promising "a few seconds" and offers Try again and Skip (review B F2).
 */
export function Waiting({ working, added, total, batchId }: { working: { id: string; since: string }[]; added: number; total: number; batchId: string }) {
  const router = useRouter();
  const { batch } = useImportQueue();
  const now = useNow(5_000);
  const [busy, setBusy] = useState<"retry" | "skip" | null>(null);
  // When the provider's copy of the batch changes shape (a card got ready, a piece failed), the page is re-rendered once.
  const signature = batch ? `${batch.id}:${batch.nextConfirmId ?? ""}:${batch.counts.needs_confirm}:${batch.counts.failed}:${batch.counts.processing + batch.counts.queued + batch.counts.uploaded}` : null;
  const seen = useRef(signature);
  useEffect(() => {
    if (signature === null || signature === seen.current) return;
    seen.current = signature;
    router.refresh();
  }, [signature, router]);
  const late = working.some((w) => isTakingLong(w.since, now));
  const ids = working.map((w) => w.id);
  async function retry() {
    setBusy("retry");
    const ok = await retryEntries(ids);
    setBusy(null);
    if (ok) router.refresh();
  }
  async function skip() {
    setBusy("skip");
    const results = await Promise.all(ids.map((id) => skipEntryAction(batchId, id)));
    setBusy(null);
    const bad = results.find((r) => !r.ok);
    if (bad && !bad.ok) { toast.error(bad.error); return; }
    router.refresh();
  }
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
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center" data-testid="waiting">
          {late ? (
            <>
              <span className="text-[18px] font-semibold" aria-live="polite">Taking long</span>
              <span className="note">{working.length === 1 ? "This piece is slower than usual." : `${working.length} pieces are slower than usual.`} Try again, or skip {working.length === 1 ? "it" : "them"} and add the photo later.</span>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={retry} disabled={busy !== null} className="pill" data-testid="waiting-retry">{busy === "retry" ? "Trying…" : "Try again"}</button>
                <button type="button" onClick={skip} disabled={busy !== null} className="pill pill-quiet" data-testid="waiting-skip">{busy === "skip" ? "Skipping…" : working.length === 1 ? "Skip it" : "Skip them"}</button>
              </div>
            </>
          ) : (
            <>
              <span className="mono mono-11" aria-live="polite">Tagging · {working.length} left</span>
              <span className="mono text-graphite">The next piece will appear here</span>
            </>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-black/[0.12]"><div className="h-[3px] bg-ink transition-[width] duration-300" style={{ width: `${total ? Math.round((added / total) * 100) : 0}%` }} /><div aria-hidden className="absolute inset-y-0 w-1/4 animate-pulse bg-ink/40 motion-reduce:hidden" style={{ left: `${total ? Math.round((added / total) * 100) : 0}%` }} /></div>
      </div>
    </div>
  );
}
