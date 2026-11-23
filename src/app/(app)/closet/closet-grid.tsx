"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useClosetPick } from "./pick-context";
import { ItemCard } from "@/components/item-card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { addPickedToLookAction } from "@/app/(app)/looks/actions";
import { MirrorSheet } from "@/components/mirror/mirror-sheet";
import { useMirror } from "@/components/mirror/use-mirror";
import { mirrorCanPlace } from "@/lib/tryon/features";
import type { ItemCardData } from "@/lib/items/query";
import type { MirrorConfig } from "@/lib/tryon/config";

/** The try-on model places up to three pieces on a body. */
const PICK_MAX = 3;

/**
 * The closet grid, with the mirror's pick mode (Jeff, 19 Oct 2026: "in closet I should be able to choose
 * pieces and have it show me in mirror"). Tap Mirror, tap pieces, tap "See it on me": the same mirror
 * sheet as Today opens and dresses them. Pieces the model can't place (hats, bags, jewelry) say so.
 */
export function ClosetGrid({ items, showOwner, mirror, lead }: { items: ItemCardData[]; showOwner: boolean; mirror: MirrorConfig | null; /** The first cells: pieces still being tagged (TaggingCards). */ lead?: ReactNode }) {
  const { picking, setPicking } = useClosetPick(); // the Mirror pill in the tools row starts it (F1)
  const [picked, setPicked] = useState<string[]>([]);
  const m = useMirror(mirror?.personId ?? "", mirror?.wardrobe, mirror?.engine);
  const onMe = mirror?.tryOn === "ready";
  const canMirror = Boolean(mirror && (onMe || mirror.mannequinAvailable));
  const full = picked.length >= PICK_MAX;
  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= PICK_MAX ? xs : [...xs, id]));
  const names = picked.map((id) => items.find((i) => i.id === id)?.name).filter(Boolean).join(" · ");
  const stop = () => { setPicking(false); setPicked([]); };
  // The picked pieces onto the open look (B1): the tray at the bottom then says how many are in it.
  const router = useRouter();
  const [, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const addToLook = () => {
    if (!mirror) return;
    setAdding(true);
    start(async () => {
      const r = await addPickedToLookAction(mirror.personId, picked);
      setAdding(false);
      if (!r.ok) { toast.error(r.error); return; }
      toast.ok(`In the look · ${r.count} ${r.count === 1 ? "piece" : "pieces"}`, r.lookId ? { label: "Open the look", href: `/looks/${r.lookId}` } : undefined);
      stop(); router.refresh();
    });
  };

  return (
    <>
      {canMirror && picking ? (
        <div className="card mt-3 flex items-center justify-between gap-2 px-4 py-2.5 text-[14px]" data-testid="pick-bar" aria-live="polite">
          <span>{picked.length ? `${picked.length} picked` : `Tap the pieces · ${onMe ? "they go on you" : "they go on a mannequin"}`} · up to {PICK_MAX}</span>
          <button type="button" onClick={stop} className="pill pill-sm" data-testid="pick-cancel">Cancel</button>
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-4 lg:grid-cols-5 lg:gap-x-4 lg:gap-y-6">
        {lead}
        {items.map((it) => (
          <ItemCard key={it.id} item={it} showOwner={showOwner}
            pick={picking ? { on: picked.includes(it.id), placeable: mirrorCanPlace(it.categoryName), full, onToggle: () => toggle(it.id) } : undefined} />
        ))}
      </div>
      {picking ? (
        <div className="fixed inset-x-0 bottom-[calc(76px_+_env(safe-area-inset-bottom))] z-30 border-t border-line bg-paper px-5 py-3 lg:bottom-0 lg:py-4">
          <div className="mx-auto flex max-w-[440px] flex-col gap-2 lg:max-w-[1040px]">
            <Button size="lg" className="w-full" disabled={!picked.length || m.busy} sub={picked.length ? names : "Tap pieces in the grid"}
              onClick={() => mirror && m.begin({ look: { kind: "closet", itemIds: picked }, on: onMe ? "me" : "mannequin" })} data-testid="see-picked">
              {m.busy ? "Dressing…" : onMe ? "See it on me" : "See it on a mannequin"}
            </Button>
            <button type="button" disabled={!picked.length || adding || m.busy} onClick={addToLook} className="pill h-[44px] w-full" data-testid="pick-add-look">{adding ? "Adding…" : "Add to a look"}</button>
          </div>
        </div>
      ) : null}
      {mirror ? <MirrorSheet m={m} pieces={names} mine personId={mirror.personId} personName={mirror.personName} tryOnState={mirror.tryOn} backPhoto={mirror.backPhoto} mannequinAvailable={mirror.mannequinAvailable} admin={mirror.admin} /> : null}
    </>
  );
}
