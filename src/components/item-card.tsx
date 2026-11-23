/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { cn } from "@/lib/cn";
import { LinkPending } from "@/components/link-pending";
import type { ItemCardData } from "@/lib/items/query";

/** In the closet's pick mode a card is a toggle, not a link: picked, or why it can't be. */
export type CardPick = { on: boolean; /** the mirror can place this kind of piece */ placeable: boolean; /** the look is full (three picked) */ full: boolean; onToggle: () => void };

/** Grid card (v2, Alta's closet grid): the cutout on a soft stage, the brand bold and the name light under it, a "New" tag on fresh pieces, "×n" on stacks. */
export function ItemCard({ item, showOwner, pick }: { item: ItemCardData; showOwner?: boolean; pick?: CardPick }) {
  const meta = [showOwner ? item.ownerName : null, item.categoryName, item.status !== "New" ? item.status : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <div className="stage relative aspect-[4/5] overflow-hidden rounded-xl">
        {item.thumbKey ? <img src={`/api/photo/${item.thumbKey}`} alt={item.name} className="size-full object-contain p-1.5" loading="lazy" decoding="async" /> : null}
        {item.copies > 1 ? <span className="absolute left-1.5 top-1.5 rounded-full bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-paper" data-testid="copies-badge">{item.copiesWord}</span> : item.isNew ? <span className="absolute left-1.5 top-1.5 rounded-full bg-paper px-1.5 py-0.5 text-[11px] font-semibold text-ink" data-testid="new-badge">New</span> : null}
        {pick?.on ? <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-ink text-[12px] text-paper" aria-hidden>✓</span> : null}
        {pick && !pick.placeable ? <span className="absolute inset-x-1.5 bottom-1.5 rounded-lg bg-paper/90 px-1 py-1 text-center text-[11px] text-graphite">Not in the mirror</span>
          : pick && pick.full && !pick.on ? <span className="absolute inset-x-1.5 bottom-1.5 rounded-lg bg-paper/90 px-1 py-1 text-center text-[11px] text-graphite">Look is full</span> : null}
      </div>
      <div className="mt-1.5 flex flex-col gap-px">
        <div className="truncate text-[13px] font-semibold">{item.brandName ?? item.name}</div>
        <div className="caption truncate">{item.brandName ? item.name : meta || " "}</div>
      </div>
    </>
  );
  if (pick) {
    const can = pick.placeable && (pick.on || !pick.full);
    // A card the look has no room for says so where it is tapped (review F H5), instead of only fading.
    const why = !pick.placeable ? "The mirror cannot place this kind of piece" : pick.full && !pick.on ? "The look is full: take one out first" : undefined;
    return (
      <button type="button" disabled={!can} aria-pressed={pick.on} aria-disabled={!can || undefined} title={why} onClick={pick.onToggle} data-testid="item-card"
        className={cn("flex flex-col text-left", pick.on && "[&>div:first-child]:outline [&>div:first-child]:outline-2 [&>div:first-child]:-outline-offset-2 [&>div:first-child]:outline-ink", !can && "opacity-50")}>
        {body}
      </button>
    );
  }
  return (
    <Link href={`/closet/${item.id}`} className="block active:opacity-70" data-testid="item-card">
      <LinkPending className="flex flex-col">{body}</LinkPending>
    </Link>
  );
}
