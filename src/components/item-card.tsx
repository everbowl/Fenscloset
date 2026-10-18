/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { ItemCardData } from "@/lib/items/query";

/** Grid card from design 02: 214px Bone tile, name 13px/500, mono meta `CATEGORY · STATUS`. */
export function ItemCard({ item, showOwner }: { item: ItemCardData; showOwner?: boolean }) {
  const meta = [showOwner ? item.ownerName : null, item.categoryName, item.status].filter(Boolean).join(" · ");
  return (
    <Link href={`/closet/${item.id}`} className="flex flex-col gap-2" data-testid="item-card">
      <div className="h-[214px] overflow-hidden bg-bone lg:h-[300px]">
        {item.thumbKey ? <img src={`/api/photo/${item.thumbKey}`} alt={item.name} className="size-full object-contain" loading="lazy" /> : null}
      </div>
      <div className="flex flex-col gap-[3px]">
        <div className="truncate text-[13px] font-medium">{item.name}</div>
        <div className="mono truncate text-graphite">{meta}</div>
      </div>
    </Link>
  );
}
