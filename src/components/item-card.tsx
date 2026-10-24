/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ItemCardData } from "@/lib/items/query";

/** In the closet's pick mode a card is a toggle, not a link: picked, or why it can't be. */
export type CardPick = { on: boolean; /** the mirror can place this kind of piece */ placeable: boolean; /** the look is full (three picked) */ full: boolean; onToggle: () => void };

/** Grid card from design 02: 214px Bone tile, name 13px/500, mono meta `CATEGORY · STATUS`. */
export function ItemCard({ item, showOwner, pick }: { item: ItemCardData; showOwner?: boolean; pick?: CardPick }) {
  const meta = [showOwner ? item.ownerName : null, item.categoryName, item.status].filter(Boolean).join(" · ");
  const body = (
    <>
      <div className="relative h-[214px] overflow-hidden bg-bone lg:h-[300px]">
        {item.thumbKey ? <img src={`/api/photo/${item.thumbKey}`} alt={item.name} className="size-full object-contain" loading="lazy" /> : null}
        {pick?.on ? <span className="mono absolute right-2 top-2 flex size-7 items-center justify-center bg-ink text-paper" aria-hidden>✓</span> : null}
        {pick && !pick.placeable ? <span className="mono absolute inset-x-2 bottom-2 bg-paper px-1.5 py-1 text-center text-graphite">Not in the mirror</span> : null}
      </div>
      <div className="flex flex-col gap-[3px]">
        <div className="truncate text-[13px] font-medium">{item.name}</div>
        <div className="mono truncate text-graphite">{meta}</div>
      </div>
    </>
  );
  if (pick) {
    const can = pick.placeable && (pick.on || !pick.full);
    return (
      <button type="button" disabled={!can} aria-pressed={pick.on} onClick={pick.onToggle} data-testid="item-card"
        className={cn("flex flex-col gap-2 text-left", pick.on && "outline outline-2 -outline-offset-2 outline-ink", !can && "opacity-50")}>
        {body}
      </button>
    );
  }
  return (
    <Link href={`/closet/${item.id}`} className="flex flex-col gap-2" data-testid="item-card">
      {body}
    </Link>
  );
}
