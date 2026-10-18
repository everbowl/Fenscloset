"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { TasteLine } from "@/lib/outfits/taste";
import { forgetTasteAction } from "../actions";

/** What the looks engine has learned from WEAR THIS, swaps and passes. Every line can be forgotten. */
export function TasteMemory({ ownerId, lines, canEdit }: { ownerId: string; lines: TasteLine[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const forget = (itemId?: string) => start(async () => { await forgetTasteAction(ownerId, itemId); router.refresh(); });
  return (
    <section data-testid="taste-memory">
      <div className="flex items-end justify-between border-b border-ink pb-2">
        <p className="mono text-graphite">What it has learned</p>
        {canEdit && lines.length ? <button type="button" disabled={pending} onClick={() => forget()} className="mono text-graphite">Forget all</button> : null}
      </div>
      {lines.length === 0 ? <p className="mono py-3 text-graphite">Nothing yet · it learns from WEAR THIS, swaps and the looks you pass on</p> : null}
      {lines.map((l) => (
        <div key={l.key} className="flex min-h-[42px] items-center justify-between gap-3 border-b border-line py-2" data-testid="taste-line">
          <Link href={`/closet/${l.itemIds[0]}`} className="text-[14px] leading-snug">{l.text}</Link>
          {canEdit ? <button type="button" disabled={pending} onClick={() => forget(l.itemIds[0])} className="mono shrink-0 py-2 text-graphite">Forget</button> : null}
        </div>
      ))}
    </section>
  );
}
