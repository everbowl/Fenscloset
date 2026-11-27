"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { plainError, retryEntries } from "@/app/(app)/add/add-screen";
import { skipEntryAction } from "@/app/(flow)/add/[batchId]/actions";
import { toast } from "@/components/ui/toast";
import { useImportQueue } from "@/components/import-queue-provider";
import { useNow } from "@/components/items/use-now";
import { isTakingLong } from "@/lib/import/timing";
import type { PendingAdds, PendingCard } from "@/lib/import/pending";

/**
 * The closet's first cards while a piece is on its way (Jeff, 20 Nov 2026): a store find or a photo shows up at once,
 * marked Tagging, and becomes the real card on its own; one that could not be tagged says why, with Try again and
 * Remove right there; one that landed without a category asks for one; one that needs a look opens its review card.
 * Photos waiting on the confirm page are one card that opens it.
 *
 * The root provider is the one poller (review B B20): this re-renders the page only when the batch's counts change,
 * instead of every 2.5 s on its own clock.
 */
export function TaggingCards({ pending }: { pending: PendingAdds }) {
  const router = useRouter();
  const { batch } = useImportQueue();
  const tagging = pending.cards.some((c) => c.status === "tagging");
  const signature = batch ? `${batch.id}:${batch.counts.queued + batch.counts.uploaded + batch.counts.processing}:${batch.counts.needs_confirm}:${batch.counts.failed}:${batch.counts.done}` : "none";
  const seen = useRef(signature);
  useEffect(() => {
    if (!tagging && signature === "none") return;
    if (signature === seen.current) return;
    seen.current = signature;
    router.refresh();
  }, [signature, tagging, router]);
  return (
    <>
      {pending.toConfirm ? (
        <Link href={`/add/${pending.toConfirm.batchId}`} className="tap flex flex-col gap-2" data-testid="to-confirm-card">
          <span className="stage flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-xl p-3 text-center">
            <span className="text-[28px] font-semibold leading-none">{pending.toConfirm.count}</span>
            <span className="text-[13px] font-medium">{pending.toConfirm.count === 1 ? "photo" : "photos"} tagged</span>
            <span className="caption">Tap to review</span>
          </span>
          <span className="pill pill-sm pill-solid w-full">Review →</span>
        </Link>
      ) : null}
      {pending.cards.map((c) => <TaggingCard key={c.id} card={c} />)}
    </>
  );
}

function TaggingCard({ card }: { card: PendingCard }) {
  const router = useRouter();
  const now = useNow();
  const [busy, setBusy] = useState<"retry" | "remove" | null>(null);
  const late = card.status === "tagging" && isTakingLong(card.since, now);
  const retry = async () => {
    setBusy("retry");
    const ok = await retryEntries([card.id]);
    setBusy(null);
    if (ok) router.refresh();
  };
  const remove = async () => {
    if (!card.batchId) return;
    setBusy("remove");
    const r = await skipEntryAction(card.batchId, card.id);
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.ok("Removed");
    router.refresh();
  };
  const badge = card.status === "failed" ? "Didn’t tag" : card.status === "review" ? "Needs a look" : card.status === "needs_category" ? "Needs a category" : late ? "Taking long" : "Tagging…";
  const picture = (
    <div className={`stage relative aspect-[4/5] overflow-hidden rounded-xl ${card.status === "tagging" && !late ? "animate-pulse" : ""}`}>
      {card.photoKey ? <img src={`/api/photo/${card.photoKey}`} alt={card.name ?? "Just added"} className="size-full object-contain" loading="lazy" /> : null}
      <span className="absolute left-1.5 top-1.5 rounded-full bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-paper">{badge}</span>
      {card.noPhoto ? <span className="absolute inset-x-1.5 bottom-1.5 rounded-lg bg-paper/90 px-1 py-1 text-center text-[11px] text-graphite">No photo yet</span> : null}
    </div>
  );
  const testId = card.status === "failed" ? "tagging-failed-card" : card.status === "review" ? "tagging-review-card" : card.status === "needs_category" ? "needs-category-card" : "tagging-card";
  if (card.status === "needs_category" && card.itemId) {
    // The piece is in the closet; the category row on its page is one tap away (review B A2.2).
    return (
      <Link href={`/closet/${card.itemId}`} className="tap flex flex-col gap-2" data-testid={testId}>
        {picture}
        <span className="flex flex-col gap-[3px]">
          <span className="truncate text-[13px] font-medium">{card.name ?? "Just added"}</span>
          <span className="note">Needs a category — tap to pick</span>
        </span>
      </Link>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid={testId} aria-live="polite">
      {picture}
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
        ) : card.status === "review" ? (
          <>
            <p className="note">{card.error ? plainError(card.error) : "Have a look before it goes in."}</p>
            {card.batchId ? <Link href={`/add/${card.batchId}?entry=${card.id}`} className="pill pill-sm mt-1 self-start" data-testid="tagging-review">Review</Link> : null}
          </>
        ) : late ? (
          <>
            {/* Past a minute the card stops promising "a few seconds" and offers a way on (review B A2.4, A2.5). */}
            <p className="note">Taking longer than usual.</p>
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

/**
 * After the last review card (Add flow v2): "3 added · see them" on the closet, scrolled to the new pieces at the top
 * of the grid. The `added` parameter is taken back off the address so a reload does not say it again.
 */
export function AddedToast({ count }: { count: number }) {
  const router = useRouter();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || count <= 0) return;
    shown.current = true;
    toast.ok(`${count} added · see them`);
    document.getElementById("just-added")?.scrollIntoView({ block: "start", behavior: "smooth" });
    const url = new URL(window.location.href);
    url.searchParams.delete("added");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [count, router]);
  return null;
}
