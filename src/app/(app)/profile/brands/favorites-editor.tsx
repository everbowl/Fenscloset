"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { PickSheet } from "@/components/items/row-editor";
import type { FavoritesView, Named } from "@/lib/profiles/service";
import { updateFavoritesAction } from "../actions";

/** Favorite brands & stores (screen 13, undrawn). Shopping leans on these. */
export function FavoritesEditor({ ownerId, favs, brands, stores, canEdit, canEditLists }: { ownerId: string; favs: FavoritesView; brands: Named[]; stores: Named[]; canEdit: boolean; canEditLists: boolean }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"brands" | "stores" | null>(null);
  const [brandList, setBrandList] = useState(brands);
  const [storeList, setStoreList] = useState(stores);
  const [error, setError] = useState<string>();
  const [, start] = useTransition();
  function save(patch: { brandIds?: string[]; storeIds?: string[] }) {
    start(async () => { const r = await updateFavoritesAction(ownerId, patch); if (!r.ok) setError(r.error); router.refresh(); });
  }
  const List = ({ title, items, ids, onEdit, testId }: { title: string; items: Named[]; ids: string[]; onEdit: () => void; testId: string }) => (
    <section>
      <div className="flex items-center justify-between border-b border-ink pb-2">
        <p className="mono text-graphite">{title}</p>
        {canEdit ? <button type="button" onClick={onEdit} className="mono py-1" data-testid={testId}>Edit</button> : null}
      </div>
      {ids.length === 0 ? <p className="mono py-3 text-graphite">None yet</p> : null}
      {ids.map((id) => <div key={id} className="flex h-[42px] items-center border-b border-line text-[14px]">{items.find((x) => x.id === id)?.name}</div>)}
    </section>
  );
  return (
    <div className="space-y-6">
      {error ? <Banner tone="danger" title={error} /> : null}
      <List title="Favorite brands" items={brandList} ids={favs.brandIds} onEdit={() => setSheet("brands")} testId="edit-brands" />
      <List title="Favorite stores" items={storeList} ids={favs.storeIds} onEdit={() => setSheet("stores")} testId="edit-stores" />
      <PickSheet open={sheet === "brands"} onClose={() => setSheet(null)} title="Favorite brands" kind="brand" options={brandList} selected={favs.brandIds} multi canAdd={canEditLists} onChange={(ids) => save({ brandIds: ids })} onAdded={(e) => setBrandList((l) => [...l, e])} />
      <PickSheet open={sheet === "stores"} onClose={() => setSheet(null)} title="Favorite stores" kind="store" options={storeList} selected={favs.storeIds} multi canAdd={canEditLists} onChange={(ids) => save({ storeIds: ids })} onAdded={(e) => setStoreList((l) => [...l, e])} />
    </div>
  );
}
