"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { plainError } from "@/app/(app)/add/add-screen";
import { skipEntryAction } from "@/app/(flow)/add/[batchId]/actions";
import { toast } from "@/components/ui/toast";
import type { PendingAdds } from "@/lib/import/pending";

/** How often the closet asks again while something is still being tagged. */
const POLL_MS = 2500;

/**
 * The closet's first cards while a piece is on its way (Jeff, 20 Nov 2026): a store find or a photo shows up at once,
 * marked Tagging, and becomes the real card on its own; one that could not be tagged says why, with Try again and
 * Remove right there. Photos waiting on the confirm page are one card that opens it.
 */
export function TaggingCards({ pending }: { pending: PendingAdds }) {
  const router = useRouter();
  const tagging = pending.cards.some((c) => c.status === "tagging");
  useEffect(() => {
    if (!tagging) return;
    const t = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [tagging, router]);
  return (
    <>
      {pending.toConfirm ? (
        <Link href={`/add/${pending.toConfirm.batchId}`} className="tap flex flex-col gap-2" data-testid="to-confirm-card">
          <span className="flex h-[214px] flex-col items-center justify-center gap-2 border border-dashed border-ink bg-bone p-4 text-center lg:h-[300px]">
            <span className="serif text-[30px] leading-none">{pending.toConfirm.count}</span>
            <span className="mono text-ink">{pending.toConfirm.count === 1 ? "photo" : "photos"} tagged</span>
            <span className="note text-ink">Tap to look them over and confirm</span>
          </span>
          <span className="pill pill-sm pill-solid w-full">Confirm →</span>
        </Link>
      ) : null}
      {pending.cards.map((c) => <TaggingCard key={c.id} card={c} />)}
    </>
  );
}

function TaggingCard({ card }: { card: PendingAdds["cards"][number] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "remove" | null>(null);
  const retry = async () => {
    setBusy("retry");
    const r = await fetch(`/api/import/entries/${card.id}/process`, { method: "POST" });
    setBusy(null);
    if (!r.ok) { toast.error("Couldn’t try again. Give it a moment."); return; }
    router.refresh();
  };
  const remove = async () => {
    setBusy("remove");
    const r = await skipEntryAction(card.batchId, card.id);
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.ok("Removed");
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-2" data-testid={card.status === "failed" ? "tagging-failed-card" : "tagging-card"} aria-live="polite">
      <div className={`relative h-[214px] overflow-hidden bg-bone lg:h-[300px] ${card.status === "tagging" ? "animate-pulse" : ""}`}>
        <img src={`/api/photo/${card.photoKey}`} alt={card.name ?? "Just added"} className="size-full object-contain" loading="lazy" />
        <span className="mono absolute left-2 top-2 bg-ink px-1.5 py-0.5 text-paper">{card.status === "failed" ? "Didn’t tag" : "Tagging…"}</span>
      </div>
      <div className="flex flex-col gap-[3px]">
        <div className="truncate text-[13px] font-medium">{card.name ?? "Just added"}</div>
        {card.status === "failed" ? (
          <>
            <p className="note">{plainError(card.error)}</p>
            <div className="mt-1 flex gap-1.5">
              <button type="button" onClick={retry} disabled={busy !== null} className="pill pill-sm" data-testid="tagging-retry">{busy === "retry" ? "Trying…" : "Try again"}</button>
              <button type="button" onClick={remove} disabled={busy !== null} className="pill pill-sm pill-quiet" data-testid="tagging-remove">{busy === "remove" ? "Removing…" : "Remove"}</button>
            </div>
          </>
        ) : <div className="note">On its way to the closet. A few seconds.</div>}
      </div>
    </div>
  );
}
