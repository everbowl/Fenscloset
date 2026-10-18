"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { PickSheet, Row } from "@/components/items/row-editor";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SizeSheet } from "@/components/profile/size-sheet";
import type { MyBrand } from "@/lib/profiles/brands";
import type { CategorySizes } from "@/lib/profiles/sizes";
import { likelyFor, type LikelySizes } from "@/lib/profiles/size-options";
import type { FavoritesView, Named } from "@/lib/profiles/service";
import { removeMyBrandAction, setMyBrandAction, updateFavoritesAction } from "../actions";

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** Favorite brands & stores (screen 13, undrawn) and "My brands & sizes": a size per item type, one tap each. */
export function FavoritesEditor({ ownerId, favs, brands, stores, myBrands, sizeOptions, likely, canEdit, canEditLists }: {
  ownerId: string; favs: FavoritesView; brands: Named[]; stores: Named[]; myBrands: MyBrand[]; sizeOptions: CategorySizes[]; likely: LikelySizes | null; canEdit: boolean; canEditLists: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"brands" | "stores" | "pickMine" | null>(null);
  const [editing, setEditing] = useState<MyBrand | null>(null);
  const [url, setUrl] = useState("");
  /** category id ("" = any) → size; only the ones touched in this sheet are saved. */
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [sizeFor, setSizeFor] = useState<CategorySizes | null>(null);
  const [brandList, setBrandList] = useState(brands);
  const [storeList, setStoreList] = useState(stores);
  const [error, setError] = useState<string>();
  const [, start] = useTransition();

  function openEdit(b: MyBrand) { setEditing(b); setUrl(b.url ?? ""); setPicked({}); }
  const current = (categoryId: string | null) => {
    const key = categoryId ?? "";
    if (key in picked) return picked[key];
    return editing?.sizes.find((s) => s.categoryId === categoryId)?.size ?? null;
  };
  function saveMine() {
    if (!editing) return;
    const b = editing;
    const sizes = Object.entries(picked).map(([k, size]) => ({ categoryId: k || null, size }));
    setEditing(null);
    start(async () => { const r = await setMyBrandAction(ownerId, { brandId: b.brandId, url, sizes }); if (!r.ok) setError(r.error); router.refresh(); });
  }
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
  const anySizes = editing?.sizes.filter((s) => s.categoryId === null) ?? [];
  return (
    <div className="space-y-6">
      {error ? <Banner tone="danger" title={error} /> : null}
      <section data-testid="my-brands">
        <div className="flex items-center justify-between border-b border-ink pb-2">
          <p className="mono text-graphite">My brands &amp; sizes</p>
          {canEdit ? <button type="button" onClick={() => setSheet("pickMine")} className="mono py-1" data-testid="add-my-brand">Add</button> : null}
        </div>
        <p className="mono mt-2 normal-case text-graphite">Your size per item type in each brand. Pick them with one tap when you add clothes: the right size and the store link come along.</p>
        {myBrands.length === 0 ? <p className="mono py-3 text-graphite">None yet</p> : null}
        {myBrands.map((b) => (
          <div key={b.brandId} className="flex min-h-[46px] items-center gap-3 border-b border-line py-1.5 text-[14px]" data-testid={`my-brand-row-${b.brandId}`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{b.name}</span>
              <span className="mono block truncate text-graphite">{[...b.sizes.map((s) => `${s.categoryName ?? "Any"} ${s.size}`), b.url ? shortUrl(b.url) : "No link"].join(" · ") || "No sizes yet"}</span>
            </span>
            {canEdit ? <><button type="button" onClick={() => openEdit(b)} className="mono py-1" data-testid={`edit-my-brand-${b.brandId}`}>Edit</button><button type="button" onClick={() => start(async () => { const r = await removeMyBrandAction(ownerId, b.brandId); if (!r.ok) setError(r.error); router.refresh(); })} className="mono py-1 text-graphite">Remove</button></> : null}
          </div>
        ))}
      </section>
      <List title="Favorite brands" items={brandList} ids={favs.brandIds} onEdit={() => setSheet("brands")} testId="edit-brands" />
      <List title="Favorite stores" items={storeList} ids={favs.storeIds} onEdit={() => setSheet("stores")} testId="edit-stores" />
      <PickSheet open={sheet === "brands"} onClose={() => setSheet(null)} title="Favorite brands" kind="brand" options={brandList} selected={favs.brandIds} multi canAdd={canEditLists} onChange={(ids) => save({ brandIds: ids })} onAdded={(e) => setBrandList((l) => [...l, e])} />
      <PickSheet open={sheet === "pickMine"} onClose={() => setSheet(null)} title="Which brand?" kind="brand" options={brandList} selected={[]} canAdd
        onChange={(ids) => { const id = ids[0]; if (!id) return; setSheet(null); const name = brandList.find((x) => x.id === id)?.name ?? ""; openEdit(myBrands.find((m) => m.brandId === id) ?? { brandId: id, name, url: null, sizes: [] }); }}
        onAdded={(e) => setBrandList((l) => [...l, e])} />
      <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.name ?? "Brand"}>
        <div className="flex flex-col gap-5">
          <section>
            <p className="mono border-b border-ink pb-2 text-graphite">Your size by item type</p>
            {sizeOptions.map((c) => {
              const v = current(c.categoryId);
              const hint = likelyFor(likely, c.categoryName);
              return <Row key={c.categoryId} label={c.categoryName} value={v ?? (hint ? `Likely ${hint} · tap to set` : "Tap to set")} muted={!v} onClick={() => setSizeFor(c)} testId={`my-size-${c.categoryName.toLowerCase()}`} />;
            })}
            {anySizes.map(() => <Row key="any" label="Any item" value={current(null) ?? "Cleared"} muted={!current(null)} onClick={() => setSizeFor({ categoryId: "", categoryName: "Any item", options: [] })} />)}
            <p className="mono mt-2 text-graphite">Tap only the types you buy from this brand.</p>
          </section>
          <Field label="Store link" htmlFor="my-brand-url" hint="Where you buy it. New pieces of this brand get this link."><Input id="my-brand-url" inputMode="url" autoCapitalize="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.lululemon.com" data-testid="my-brand-url" /></Field>
          <Button size="lg" onClick={saveMine} data-testid="save-my-brand">Save</Button>
        </div>
      </Sheet>
      <SizeSheet open={Boolean(sizeFor)} onClose={() => setSizeFor(null)} title={sizeFor ? `${editing?.name ?? ""} · ${sizeFor.categoryName}` : ""} options={sizeFor?.options ?? []} value={sizeFor ? current(sizeFor.categoryId || null) : null} suggested={sizeFor ? likelyFor(likely, sizeFor.categoryName) : null}
        onPick={(v) => { if (sizeFor) setPicked((p) => ({ ...p, [sizeFor.categoryId]: v })); }} />
      <PickSheet open={sheet === "stores"} onClose={() => setSheet(null)} title="Favorite stores" kind="store" options={storeList} selected={favs.storeIds} multi canAdd={canEditLists} onChange={(ids) => save({ storeIds: ids })} onAdded={(e) => setStoreList((l) => [...l, e])} />
    </div>
  );
}
