"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { PickSheet } from "@/components/items/row-editor";
import { BrandSearch } from "@/components/items/brand-search";
import { MyBrandSheet } from "@/components/profile/my-brand-sheet";
import { UndoStrip, useUndoable } from "@/components/ui/undo-strip";
import type { MyBrand } from "@/lib/profiles/brands";
import type { CategorySizes } from "@/lib/profiles/sizes";
import type { LikelySizes } from "@/lib/profiles/size-options";
import type { FavoritesView, Named } from "@/lib/profiles/service";
import { removeMyBrandAction, updateFavoritesAction } from "../actions";

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/**
 * Favorite brands & stores (screen 13, undrawn) and "My brands & sizes": a size per item type, one tap each. Sizes are
 * body data: the section shows only to a viewer who may see them (review E A1); the brand and store lists show to all.
 */
export function FavoritesEditor({ ownerId, ownerFirst, mine, favs, brands, stores, myBrands, sizeOptions, likely, canEdit, canSeeSizes, canEditLists }: {
  ownerId: string; ownerFirst: string; mine: boolean; favs: FavoritesView; brands: Named[]; stores: Named[]; myBrands: MyBrand[]; sizeOptions: CategorySizes[]; likely: LikelySizes | null; canEdit: boolean; canSeeSizes: boolean; canEditLists: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"brands" | "stores" | "pickMine" | null>(null);
  const [editing, setEditing] = useState<MyBrand | null>(null);
  const [brandList, setBrandList] = useState(brands);
  const [storeList, setStoreList] = useState(stores);
  const [error, setError] = useState<string>();
  const [, start] = useTransition();
  const undoable = useUndoable();
  const [gone, setGone] = useState<string[]>([]); // brands taken away, until the strip runs out (Q1)
  const your = mine ? "Your" : `${ownerFirst}'s`;

  function openEdit(b: MyBrand) { setEditing(b); }
  function save(patch: { brandIds?: string[]; storeIds?: string[] }) {
    start(async () => { const r = await updateFavoritesAction(ownerId, patch); if (!r.ok) setError(r.error); router.refresh(); });
  }
  const List = ({ title, blurb, items, ids, onEdit, testId }: { title: string; blurb?: string; items: Named[]; ids: string[]; onEdit: () => void; testId: string }) => (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="section">{title}</h2>
        {canEdit ? <button type="button" onClick={onEdit} className="pill pill-sm" data-testid={testId}>{ids.length ? "Edit" : "+ Add"}</button> : null}
      </div>
      {blurb ? <p className="note mt-1">{blurb}</p> : null}
      <div className="card mt-3 divide-y divide-line overflow-hidden p-0">
        {ids.length === 0 ? <p className="note px-4 py-3">None yet</p> : null}
        {ids.map((id) => <div key={id} className="flex h-12 items-center px-4 text-[15px]">{items.find((x) => x.id === id)?.name}</div>)}
      </div>
    </section>
  );
  return (
    <div className="space-y-8">
      {error ? <Banner tone="danger" title={error} /> : null}
      {canSeeSizes ? (
        <section data-testid="my-brands">
          <div className="flex items-center justify-between gap-3">
            <h2 className="section">{mine ? "My" : `${ownerFirst}'s`} sizes by brand</h2>
            {canEdit ? <button type="button" onClick={() => setSheet("pickMine")} className="pill pill-sm pill-solid" data-testid="add-my-brand">+ Add brand</button> : null}
          </div>
          <p className="note mt-1">{your} size per item type in each brand. One tap when adding clothes brings the right size and the store link along.</p>
          {undoable.pending ? <UndoStrip text={undoable.pending.text} onUndo={undoable.undo} testId="my-brand-undo" className="mt-2" /> : null}
          <div className="card mt-3 divide-y divide-line overflow-hidden p-0">
            {myBrands.length === 0 && !undoable.pending ? <p className="note px-4 py-3">None yet</p> : null}
            {myBrands.filter((b) => !gone.includes(b.brandId)).map((b) => (
              <div key={b.brandId} className="flex min-h-[52px] items-center gap-3 px-4 py-2 text-[15px]" data-testid={`my-brand-row-${b.brandId}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="caption block truncate">{[...b.sizes.map((s) => `${s.categoryName ?? "Any"} ${s.size}`), b.url ? shortUrl(b.url) : "No link"].join(" · ") || "No sizes yet"}</span>
                </span>
                {canEdit ? <><button type="button" onClick={() => openEdit(b)} className="pill pill-sm" data-testid={`edit-my-brand-${b.brandId}`}>Edit</button><button type="button" onClick={() => { const id = b.brandId; setGone((g) => [...g, id]); undoable.start(`Removed · ${b.name}`, () => start(async () => { const r = await removeMyBrandAction(ownerId, id); if (!r.ok) setError(r.error); router.refresh(); }), () => setGone((g) => g.filter((x) => x !== id))); }} className="pill pill-sm pill-quiet" data-testid={`remove-my-brand-${b.brandId}`}>Remove</button></> : null}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="note" data-testid="sizes-private">{`${ownerFirst}'s sizes stay with ${ownerFirst}${canEdit ? "" : " and the people they chose"}.`}</p>
      )}
      <List title="Brands to watch" blurb="The Shop shows what is new from these every day." items={brandList} ids={favs.brandIds} onEdit={() => setSheet("brands")} testId="edit-brands" />
      <List title="Favorite stores" blurb={`Where ${mine ? "you like" : `${ownerFirst} likes`} to buy; the Shop leans on these.`} items={storeList} ids={favs.storeIds} onEdit={() => setSheet("stores")} testId="edit-stores" />
      <BrandSearch open={sheet === "brands"} onClose={() => setSheet(null)} title="Favorite brands" brands={brandList} multi selectedIds={favs.brandIds}
        onPick={(b) => save({ brandIds: favs.brandIds.includes(b.id) ? favs.brandIds.filter((x) => x !== b.id) : [...favs.brandIds, b.id] })} onAdded={(e) => setBrandList((l) => [...l, e])} />
      <BrandSearch open={sheet === "pickMine"} onClose={() => setSheet(null)} title="Which brand?" brands={brandList} selectedId={null}
        onPick={(b) => { setSheet(null); openEdit(myBrands.find((m) => m.brandId === b.id) ?? { brandId: b.id, name: b.name, url: null, sizes: [] }); }}
        onAdded={(e) => setBrandList((l) => [...l, e])} />
      {editing ? <MyBrandSheet key={editing.brandId} ownerId={ownerId} brand={editing} sizeOptions={sizeOptions} likely={likely} canEditLink={canEditLists || !editing.url} onClose={() => setEditing(null)} onSaved={() => router.refresh()} onError={setError} /> : null}
      <PickSheet open={sheet === "stores"} onClose={() => setSheet(null)} title="Favorite stores" kind="store" options={storeList} selected={favs.storeIds} multi canAdd={canEditLists} onChange={(ids) => save({ storeIds: ids })} onAdded={(e) => setStoreList((l) => [...l, e])} />
    </div>
  );
}
