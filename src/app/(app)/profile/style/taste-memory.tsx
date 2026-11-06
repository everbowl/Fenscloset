"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TasteLine } from "@/lib/outfits/taste";
import { UndoStrip, useUndoable } from "@/components/ui/undo-strip";
import { forgetTasteAction } from "../actions";

/** What the looks engine has learned from WEAR THIS, swaps and passes. Every line can be forgotten, with five seconds to take it back (Q1). */
export function TasteMemory({ ownerId, lines, canEdit }: { ownerId: string; lines: TasteLine[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<string[]>([]); // item ids gone from the screen; "all" for the whole list
  const forget = (itemId?: string) => start(async () => { await forgetTasteAction(ownerId, itemId); router.refresh(); });
  const shown = hidden.includes("all") ? [] : lines.filter((l) => !hidden.includes(l.itemIds[0]));
  return (
    <section data-testid="taste-memory">
      <div className="flex items-end justify-between border-b border-ink pb-2">
        <p className="mono text-graphite">What it has learned</p>
        {canEdit && shown.length ? <button type="button" disabled={pending} onClick={() => { setHidden(["all"]); undoable.start("Forgotten · everything it learned", () => forget(), () => setHidden([])); }} className="pill pill-sm pill-quiet" data-testid="forget-all">Forget all</button> : null}
      </div>
      {undoable.pending ? <UndoStrip text={undoable.pending.text} onUndo={undoable.undo} testId="taste-undo" className="mt-2" /> : null}
      {shown.length === 0 && !undoable.pending ? <p className="mono py-3 text-graphite">Nothing yet · it learns from WEAR THIS, swaps and the looks you pass on</p> : null}
      {shown.map((l) => (
        <div key={l.key} className="flex min-h-[42px] items-center justify-between gap-3 border-b border-line py-2" data-testid="taste-line">
          <Link href={`/closet/${l.itemIds[0]}`} className="text-[14px] leading-snug">{l.text}</Link>
          {canEdit ? <button type="button" disabled={pending} onClick={() => { const id = l.itemIds[0]; setHidden((h) => [...h, id]); undoable.start("Forgotten", () => forget(id), () => setHidden((h) => h.filter((x) => x !== id))); }} className="pill pill-sm pill-quiet shrink-0">Forget</button> : null}
        </div>
      ))}
    </section>
  );
}
