"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { PickSheet, Row, TextSheet } from "@/components/items/row-editor";
import { shrinkPhoto } from "@/lib/import/client-queue";
import type { ItemLists } from "@/lib/items/query";
import type { ItemDetailEdits } from "@/lib/items/service";
import type { LaundryStatus, PhotoKind } from "@/generated/prisma/client";
import { addItemPhotoAction, cycleLaundryAction, deleteItemAction, removeItemPhotoAction, updateItemAction } from "./actions";
import { unretireAction } from "../clean-out/actions";
import { monoDate } from "@/lib/dates";

export type ItemView = {
  id: string; name: string; ownerId: string; ownerName: string; mine: boolean; status: string; laundryStatus: LaundryStatus;
  isFavorite: boolean; neverSuggest: boolean; wearCount: number;
  categoryId: string | null; subcategoryId: string | null; colorIds: string[]; patternId: string | null; fabricId: string | null;
  seasonIds: string[]; formalityId: string | null; occasionIds: string[]; tagIds: string[]; brandId: string | null; storeId: string | null;
  size: string | null; purchasePrice: string | null; purchaseDate: string | null; purchaseUrl: string | null; fitNotes: string | null;
  closetIds: string[]; sharedWithIds: string[];
  photos: { id: string; kind: PhotoKind; key: string; isPrimary: boolean }[];
  lastWornAt: string | null;
  wearHistory: { wornOn: string; title: string | null }[];
  retired: { reason: string; at: string } | null;
};

type SheetKind = "category" | "subcategory" | "color" | "pattern" | "fabric" | "season" | "formality" | "occasion" | "tag" | "brand" | "store" | "size" | "price" | "date" | "url" | "notes" | "closets" | "share" | "rename" | "photo" | "delete" | null;

const LAUNDRY_WORD: Record<LaundryStatus, string> = { clean: "Clean", dirty: "Laundry", cleaners: "At cleaners" };
const KIND_WORD: Record<PhotoKind, string> = { alone: "Photo", worn: "Worn", label: "Label", cutout: "Cutout", thumb: "Thumb", back: "Back" };

function Title({ name }: { name: string }) {
  const words = name.trim().split(" ");
  const last = words.pop();
  return <h1 className="serif text-[34px]">{words.join(" ")}{words.length ? " " : ""}<em>{last}</em></h1>;
}

/** Item detail: photo, serif title, mono meta, then every tag as a 42px row that edits in place. */
export function ItemEditor({ item, lists: initialLists, canEdit, canEditLists }: { item: ItemView; lists: ItemLists; canEdit: boolean; canEditLists: boolean }) {
  const router = useRouter();
  const [it, setIt] = useState(item);
  const [lists, setLists] = useState(initialLists);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoKind, setPhotoKind] = useState<"alone" | "worn" | "label" | "back">("alone");
  const [uploading, setUploading] = useState(false);

  const name = (xs: { id: string; name: string }[], id: string | null) => xs.find((x) => x.id === id)?.name ?? null;
  const names = (xs: { id: string; name: string }[], ids: string[]) => ids.map((id) => name(xs, id)).filter(Boolean).join(", ");
  const category = lists.categories.find((c) => c.id === it.categoryId) ?? null;
  const sub = category ? name(category.subcategories, it.subcategoryId) : null;
  const open = (k: SheetKind) => { if (canEdit) setSheet(k); };

  function save(patch: ItemDetailEdits, local: Partial<ItemView>) {
    setIt((x) => ({ ...x, ...local }));
    setError(undefined);
    start(async () => { const r = await updateItemAction(it.id, patch); if (!r.ok) { setError(r.error); router.refresh(); } });
  }
  function laundry() {
    start(async () => { const r = await cycleLaundryAction(it.id); if (r.ok) setIt((x) => ({ ...x, laundryStatus: r.value, status: r.value === "dirty" ? "Laundry" : r.value === "cleaners" ? "At cleaners" : x.wearCount > 0 ? `Worn ${x.wearCount}×` : "New" })); else setError(r.error); });
  }
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setUploading(true); setError(undefined); setSheet(null);
    try {
      const blob = await shrinkPhoto(file);
      const kindKey = photoKind === "label" ? "labels" : photoKind === "worn" ? "worn" : "originals";
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: kindKey }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const r = await addItemPhotoAction(it.id, photoKind, signed.key);
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (err) { setError((err as Error).message); } finally { setUploading(false); }
  }

  const photo = it.photos[Math.min(photoIdx, it.photos.length - 1)] ?? null;
  const brandName = name(lists.brands, it.brandId);
  const price = it.purchasePrice ? `$${Number(it.purchasePrice).toFixed(2).replace(/\.00$/, "")}` : null;

  return (
    <div className="-mt-5 lg:mt-0 lg:grid lg:grid-cols-[440px_minmax(0,1fr)] lg:gap-x-12 lg:gap-y-0">
      <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} data-testid="item-photo" />
      <div className="relative -mx-5 h-[380px] bg-bone lg:mx-0 lg:h-[560px] lg:self-start lg:[grid-row:1/span_80]">
        {photo ? <img src={`/api/photo/${photo.key}`} alt={it.name} className="size-full object-cover" style={{ objectPosition: "center 30%" }} /> : null}
        <Link href="/closet" aria-label="Back to closet" className="absolute left-2 top-2 flex size-11 items-center justify-center bg-paper text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </Link>
        {photo?.kind === "worn" || photo?.kind === "back" ? <span className="mono mono-11 absolute right-2 top-2 bg-paper px-2.5 py-1.5">{KIND_WORD[photo.kind]}</span> : null}
      </div>
      {it.photos.length > 1 ? (
        <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pt-1.5 [scrollbar-width:none] lg:mx-0 lg:px-0 lg:pt-0">
          {it.photos.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setPhotoIdx(i)} aria-label={`${KIND_WORD[p.kind]} photo`} aria-pressed={i === photoIdx} className={`h-[62px] w-[48px] shrink-0 overflow-hidden bg-bone ${i === photoIdx ? "outline outline-2 -outline-offset-2 outline-ink" : ""}`}>
              <img src={`/api/photo/${p.key}`} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end justify-between pt-[18px]">
        <Title name={it.name} />
        {canEdit ? <button type="button" onClick={() => open("rename")} className="mono mono-11 py-2">Rename</button> : null}
      </div>
      <p className="mono mt-2 text-graphite">{[!it.mine ? it.ownerName : null, category?.name, it.status, it.isFavorite ? "Favorite" : null].filter(Boolean).join(" · ")}</p>

      {it.retired ? (
        <div className="mt-3 flex items-center justify-between border-y border-ink py-2.5" data-testid="retired-strip">
          <span className="mono tracking-[0.1em]">Retired · {it.retired.reason === "sell" ? "to sell" : "to donate"}</span>
          {canEdit ? <button type="button" disabled={pending} onClick={() => start(async () => { const r = await unretireAction(it.id); if (!r.ok) setError(r.error); else { setIt((x) => ({ ...x, retired: null })); router.refresh(); } })} className="mono py-2 tracking-[0.1em]">Bring it back</button> : null}
        </div>
      ) : null}
      {canEdit && !it.retired ? (
        <div className="mt-3 flex items-center justify-between border-y border-ink py-2.5">
          <span className="mono tracking-[0.1em]">Laundry · {LAUNDRY_WORD[it.laundryStatus]}</span>
          <button type="button" onClick={laundry} disabled={pending} data-testid="laundry-cycle" className="mono py-2 tracking-[0.1em]">
            {it.laundryStatus === "clean" ? "In the wash?" : it.laundryStatus === "dirty" ? "At cleaners?" : "Back & clean?"}
          </button>
        </div>
      ) : null}

      <div className="flex flex-col">
        <Row label="Category" value={category ? `${category.name}${sub ? ` · ${sub}` : ""}` : "Pick a category"} muted={!category} onClick={() => open("category")} testId="row-category" />
        <Row label="Color" value={names(lists.colors, it.colorIds) || "Pick a color"} muted={!it.colorIds.length} onClick={() => open("color")} />
        <Row label="Pattern" value={name(lists.patterns, it.patternId) ?? "Not set"} muted={!it.patternId} onClick={() => open("pattern")} />
        <Row label="Fabric" value={name(lists.fabrics, it.fabricId) ?? "Not set"} muted={!it.fabricId} onClick={() => open("fabric")} />
        <Row label="Season" value={names(lists.seasons, it.seasonIds) || "Any"} onClick={() => open("season")} />
        <Row label="Dress code" value={name(lists.formalities, it.formalityId) ?? "Not set"} muted={!it.formalityId} onClick={() => open("formality")} />
        <Row label="Occasions" value={names(lists.occasions, it.occasionIds) || "Any"} onClick={() => open("occasion")} />
        <Row label="Tags" value={names(lists.tags, it.tagIds) || "None"} muted={!it.tagIds.length} onClick={() => open("tag")} />
        <Row label="Brand · Size" value={[brandName, it.size].filter(Boolean).join(" · ") || "Not set"} muted={!brandName && !it.size} onClick={() => open("brand")} />
        <Row label="Store" value={name(lists.stores, it.storeId) ?? "Not set"} muted={!it.storeId} onClick={() => open("store")} />
        <Row label="Price · Date" value={[price, it.purchaseDate].filter(Boolean).join(" · ") || "Not set"} muted={!price && !it.purchaseDate} onClick={() => open("price")} />
        <Row label="Link" value={it.purchaseUrl ?? "Not set"} muted={!it.purchaseUrl} onClick={() => open("url")} />
        <Row label="Fit notes" value={it.fitNotes ?? "None"} muted={!it.fitNotes} onClick={() => open("notes")} />
        <div className="flex min-h-[42px] items-center border-b border-line" data-testid="row-worn">
          <span className="mono w-[120px] shrink-0 text-graphite">Worn</span>
          <span className="flex-1 text-[14px]">{it.wearHistory.length ? `${it.wearCount}× · last ${monoDate(it.wearHistory[0].wornOn)}` : "Not yet"}</span>
        </div>
        {it.wearHistory.slice(0, 5).map((w) => (
          <Link key={w.wornOn} href={`/fits?d=${w.wornOn}`} className="flex h-[42px] items-center border-b border-line">
            <span className="mono w-[120px] shrink-0 text-graphite">{monoDate(w.wornOn)}</span>
            <span className="flex-1 truncate text-[14px]">{w.title ?? "Worn"}</span>
            <span className="mono text-graphite">Fits →</span>
          </Link>
        ))}
        <Row label="Closets" value={["Personal", ...it.closetIds.map((id) => name(lists.closets, id))].filter(Boolean).join(", ")} onClick={() => open("closets")} testId="row-closets" />
        <Row label="Shared with" value={names(lists.people, it.sharedWithIds) || "Nobody extra"} muted={!it.sharedWithIds.length} onClick={() => open("share")} />
        {canEdit ? (
          <>
            <button type="button" onClick={() => save({ isFavorite: !it.isFavorite }, { isFavorite: !it.isFavorite })} className="flex h-[42px] items-center border-b border-line text-left">
              <span className="mono w-[120px] shrink-0 text-graphite">Favorite</span><span className="flex-1 text-[14px]">{it.isFavorite ? "Yes" : "No"}</span><span className="mono text-graphite">Tap to change</span>
            </button>
            <button type="button" onClick={() => save({ neverSuggest: !it.neverSuggest }, { neverSuggest: !it.neverSuggest })} className="flex h-[42px] items-center border-b border-line text-left">
              <span className="mono w-[120px] shrink-0 text-graphite">Suggest it</span><span className="flex-1 text-[14px]">{it.neverSuggest ? "Never" : "Yes"}</span><span className="mono text-graphite">Tap to change</span>
            </button>
          </>
        ) : null}
      </div>

      {error ? <div className="pt-3"><Banner tone="danger" title={error} /></div> : null}
      {uploading ? <p className="mono pt-3 text-graphite">Saving the photo…</p> : null}

      {canEdit ? (
        <div className="flex gap-2.5 pt-5">
          <Button size="lg" className="flex-1" onClick={() => setSheet("photo")} disabled={uploading}>Add photo</Button>
          <Button size="lg" variant="secondary" onClick={() => setSheet("delete")}>Delete</Button>
        </div>
      ) : null}

      {/* Sheets */}
      <PickSheet open={sheet === "category"} onClose={() => setSheet(null)} title="Category" kind="category" options={lists.categories} selected={it.categoryId ? [it.categoryId] : []} canAdd={canEditLists}
        onChange={(ids) => { save({ categoryId: ids[0] ?? null, subcategoryId: null }, { categoryId: ids[0] ?? null, subcategoryId: null }); if (ids[0] && (lists.categories.find((c) => c.id === ids[0])?.subcategories.length ?? 0) > 0) setSheet("subcategory"); }}
        onAdded={(e) => setLists((l) => ({ ...l, categories: [...l.categories, { ...e, subcategories: [] }] }))} />
      <PickSheet open={sheet === "subcategory"} onClose={() => setSheet(null)} title={category ? `${category.name} · type` : "Type"} kind="subcategory" parentId={category?.id} options={category?.subcategories ?? []} selected={it.subcategoryId ? [it.subcategoryId] : []} canAdd={canEditLists}
        onChange={(ids) => save({ subcategoryId: ids[0] ?? null }, { subcategoryId: ids[0] ?? null })}
        onAdded={(e) => setLists((l) => ({ ...l, categories: l.categories.map((c) => (c.id === category?.id ? { ...c, subcategories: [...c.subcategories, e] } : c)) }))} />
      <PickSheet open={sheet === "color"} onClose={() => setSheet(null)} title="Color" kind="color" options={lists.colors} selected={it.colorIds} multi canAdd={canEditLists} onChange={(ids) => save({ colorIds: ids }, { colorIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, colors: [...l.colors, e] }))} />
      <PickSheet open={sheet === "pattern"} onClose={() => setSheet(null)} title="Pattern" kind="pattern" options={lists.patterns} selected={it.patternId ? [it.patternId] : []} canAdd={canEditLists} onChange={(ids) => save({ patternId: ids[0] ?? null }, { patternId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, patterns: [...l.patterns, e] }))} />
      <PickSheet open={sheet === "fabric"} onClose={() => setSheet(null)} title="Fabric" kind="fabric" options={lists.fabrics} selected={it.fabricId ? [it.fabricId] : []} canAdd={canEditLists} onChange={(ids) => save({ fabricId: ids[0] ?? null }, { fabricId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, fabrics: [...l.fabrics, e] }))} />
      <PickSheet open={sheet === "season"} onClose={() => setSheet(null)} title="Season" kind="season" options={lists.seasons} selected={it.seasonIds} multi canAdd={canEditLists} onChange={(ids) => save({ seasonIds: ids }, { seasonIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, seasons: [...l.seasons, e] }))} />
      <PickSheet open={sheet === "formality"} onClose={() => setSheet(null)} title="Dress code" kind="formality" options={lists.formalities} selected={it.formalityId ? [it.formalityId] : []} canAdd={canEditLists} onChange={(ids) => save({ formalityId: ids[0] ?? null }, { formalityId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, formalities: [...l.formalities, e] }))} />
      <PickSheet open={sheet === "occasion"} onClose={() => setSheet(null)} title="Occasions" kind="occasion" options={lists.occasions} selected={it.occasionIds} multi canAdd={canEditLists} onChange={(ids) => save({ occasionIds: ids }, { occasionIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, occasions: [...l.occasions, e] }))} />
      <PickSheet open={sheet === "tag"} onClose={() => setSheet(null)} title="Tags" kind="tag" options={lists.tags} selected={it.tagIds} multi canAdd={canEditLists} onChange={(ids) => save({ tagIds: ids }, { tagIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, tags: [...l.tags, e] }))} />
      <Sheet open={sheet === "brand"} onClose={() => setSheet(null)} title="Brand · Size">
        <div className="flex flex-col">
          <BrandPick lists={lists} brandId={it.brandId} canAdd={canEditLists} onChange={(id) => save({ brandId: id }, { brandId: id })} onAdded={(e) => setLists((l) => ({ ...l, brands: [...l.brands, e] }))} />
          <Row label="Size" value={it.size ?? "Add a size"} muted={!it.size} onClick={() => setSheet("size")} />
          <button type="button" onClick={() => { setPhotoKind("label"); photoRef.current?.click(); }} className="mono mt-4 flex h-[46px] items-center justify-center border border-ink">Add a label photo</button>
        </div>
      </Sheet>
      <PickSheet open={sheet === "store"} onClose={() => setSheet(null)} title="Store" kind="store" options={lists.stores} selected={it.storeId ? [it.storeId] : []} canAdd={canEditLists} onChange={(ids) => save({ storeId: ids[0] ?? null }, { storeId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, stores: [...l.stores, e] }))} />
      <PickSheet open={sheet === "closets"} onClose={() => setSheet(null)} title="Closets" kind="closet" options={lists.closets.map((c) => ({ id: c.id, name: c.kind === "family" ? `${c.name} (everyone)` : c.name }))} selected={it.closetIds} multi canAdd={canEditLists} onChange={(ids) => save({ closetIds: ids }, { closetIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, closets: [...l.closets, { ...e, kind: "custom" }] }))} />
      <PickSheet open={sheet === "share"} onClose={() => setSheet(null)} title="Share with" kind="tag" options={lists.people} selected={it.sharedWithIds} multi canAdd={false} onChange={(ids) => save({ sharedWithIds: ids }, { sharedWithIds: ids })} />
      <TextSheet open={sheet === "size"} onClose={() => setSheet("brand")} title="Size" label="Size" value={it.size ?? ""} placeholder="M · 28 · 8 · EU 38" onSave={(v) => save({ sizeText: v }, { size: v.trim() || null })} />
      <TextSheet open={sheet === "rename"} onClose={() => setSheet(null)} title="Rename" label="Name" value={it.name} onSave={(v) => save({ name: v }, { name: v.trim() || it.name })} />
      <TextSheet open={sheet === "price"} onClose={() => setSheet(null)} title="Price" label="Price" value={it.purchasePrice ?? ""} placeholder="48.50" onSave={(v) => { save({ purchasePrice: v }, { purchasePrice: v.replace(/[$,\s]/g, "") || null }); setSheet("date"); }} />
      <TextSheet open={sheet === "date"} onClose={() => setSheet(null)} title="Bought on" label="Date (YYYY-MM-DD)" value={it.purchaseDate ?? ""} placeholder="2026-10-18" onSave={(v) => save({ purchaseDate: v }, { purchaseDate: v.trim() || null })} />
      <TextSheet open={sheet === "url"} onClose={() => setSheet(null)} title="Link" label="Where you bought it" value={it.purchaseUrl ?? ""} placeholder="https://" onSave={(v) => save({ purchaseUrl: v }, { purchaseUrl: v.trim() || null })} />
      <TextSheet open={sheet === "notes"} onClose={() => setSheet(null)} title="Fit notes" label="How it fits" value={it.fitNotes ?? ""} placeholder="Runs small · long in the arms" onSave={(v) => save({ fitNotes: v }, { fitNotes: v.trim() || null })} />
      <Sheet open={sheet === "photo"} onClose={() => setSheet(null)} title="Add a photo">
        <div className="flex flex-col">
          {([["alone", "Another photo", "Hanger or flat-lay"], ["back", "Back of the piece", "Graphic · cut"], ["worn", "Worn photo", "How it fits"], ["label", "Label", "Brand · size"]] as const).map(([k, l, m]) => (
            <button key={k} type="button" onClick={() => { setPhotoKind(k); photoRef.current?.click(); }} className="flex h-12 items-center justify-between border-b border-line text-[15px]">{l}<span className="mono text-graphite">{m}</span></button>
          ))}
          {it.photos.length > 1 && photo ? (
            <button type="button" onClick={() => start(async () => { const r = await removeItemPhotoAction(it.id, photo.id); if (!r.ok) setError(r.error); setSheet(null); setPhotoIdx(0); router.refresh(); })} className="mono mt-5 flex h-[46px] items-center justify-center border border-ink">Remove the photo shown</button>
          ) : null}
        </div>
      </Sheet>
      <Sheet open={sheet === "delete"} onClose={() => setSheet(null)} title="Delete this piece?">
        <p className="text-[14px] leading-snug">It leaves every closet and its photos are removed. This can&apos;t be undone.</p>
        <div className="mt-5 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={() => setSheet(null)}>Keep it</Button>
          <Button className="flex-1" disabled={pending} data-testid="confirm-delete" onClick={() => start(async () => { const r = await deleteItemAction(it.id); if (!r.ok) { setError(r.error); setSheet(null); return; } router.push("/closet"); router.refresh(); })}>Delete</Button>
        </div>
      </Sheet>
    </div>
  );
}

function BrandPick({ lists, brandId, canAdd, onChange, onAdded }: { lists: ItemLists; brandId: string | null; canAdd: boolean; onChange: (id: string | null) => void; onAdded: (e: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const brand = lists.brands.find((b) => b.id === brandId)?.name ?? null;
  return (
    <>
      <Row label="Brand" value={brand ?? "Pick a brand"} muted={!brand} onClick={() => setOpen(true)} />
      <PickSheet open={open} onClose={() => setOpen(false)} title="Brand" kind="brand" options={lists.brands} selected={brandId ? [brandId] : []} canAdd={canAdd} onChange={(ids) => onChange(ids[0] ?? null)} onAdded={onAdded} />
    </>
  );
}
