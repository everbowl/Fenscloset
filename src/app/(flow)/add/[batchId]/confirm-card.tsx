"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button, Icons } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import type { Named, TagLists, TagResult } from "@/lib/ai/tag-item";
import type { ItemEdits } from "@/lib/items/service";
import type { DuplicateHint } from "@/lib/items/duplicates";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { attachPhotoAction, confirmEntryAction, mergeEntryAction, mirrorEntryAction, rotateEntryAction, saveEditsAction, skipEntryAction, unskipEntryAction } from "./actions";
import { UndoStrip } from "@/components/ui/undo-strip";
import { PickSheet, Row, TextSheet } from "@/components/items/row-editor";
import { BrandSearch } from "@/components/items/brand-search";
import { MatchSheet } from "@/components/items/match-sheet";
import { matchEntryAction } from "@/lib/brands/actions";
import type { Product } from "@/lib/shop/products";
import type { MyBrand } from "@/lib/profiles/brands";
import { sizeFor } from "@/lib/profiles/size-options";

type Props = {
  batchId: string;
  entry: { id: string; photoKey: string; labelKey: string | null; wornKey: string | null; backKey: string | null; retailKeys: string[]; warnings: string[] };
  /** From Profile → Brands: one tap fills brand, size and (at save) the store link. */
  myBrands: MyBrand[];
  tags: TagResult;
  lists: TagLists;
  counter: string;
  progress: number;
  duplicate: DuplicateHint | null;
  canEditLists: boolean;
  readyCount: number;
};

type SheetKind = "category" | "subcategory" | "color" | "fabric" | "season" | "formality" | "brand" | "size" | "rename" | "camera" | "match" | null;

function Title({ name }: { name: string }) {
  const words = name.trim().split(" ");
  const last = words.pop();
  return <h1 className="serif text-[34px]">{words.join(" ")}{words.length ? " " : ""}<em>{last}</em></h1>;
}

const nameOf = (xs: Named[], id: string | null) => xs.find((x) => x.id === id)?.name ?? null;

/** Design 03: one tap per item when the tags are right. */
export function ConfirmCard({ batchId, entry, tags: initial, lists: initialLists, counter, progress, duplicate, canEditLists, readyCount, myBrands }: Props) {
  const [askMore, setAskMore] = useState(true);
  /** "Another one like X?" asks once per entry (dismissal survives a reload through sessionStorage). */
  const [askLike, setAskLike] = useState<boolean>(() => Boolean(duplicate) && typeof window !== "undefined" && !window.sessionStorage.getItem(`like-asked:${entry.id}`));
  const [mirrored, setMirrored] = useState(false);
  function dismissLike() { setAskLike(false); try { window.sessionStorage.setItem(`like-asked:${entry.id}`, "1"); } catch { /* private mode */ } }
  function mirror() {
    if (!duplicate) return;
    dismissLike();
    start(async () => { const r = await mirrorEntryAction(entry.id, duplicate.itemId); if (!r.ok) { setError(r.error); return; } setTags(r.value); setMirrored(true); });
  }
  const router = useRouter();
  // Each piece starts at the top (router.refresh keeps the old scroll, which left the next photo above the fold).
  useEffect(() => { window.scrollTo({ top: 0 }); }, []);
  const [tags, setTags] = useState(initial);
  const [lists, setLists] = useState(initialLists);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [brandPicking, setBrandPicking] = useState(false); // the brand search takes the Brand · Size sheet's place, never stacks on it; a pick lands back on the card, Close goes back to the sheet
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const labelRef = useRef<HTMLInputElement>(null);
  const wornRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<"label" | "worn" | "back" | null>(null);
  const [labelKey, setLabelKey] = useState(entry.labelKey);
  const [wornKey, setWornKey] = useState(entry.wornKey);
  const [backKey, setBackKey] = useState(entry.backKey);
  const [photoKey, setPhotoKey] = useState(entry.photoKey);
  const [side, setSide] = useState<"front" | "back" | "store">("front");
  const [retailKeys, setRetailKeys] = useState<string[]>(entry.retailKeys);
  const [matched, setMatched] = useState<{ store: string; priceText: string | null } | null>(null);
  const [matching, setMatching] = useState(false);
  const shownKey = side === "store" && retailKeys[0] ? retailKeys[0] : side === "back" && backKey ? backKey : photoKey;
  function pickMatch(pick: Product) {
    setMatching(true); setError(undefined);
    start(async () => {
      const r = await matchEntryAction(entry.id, pick, nameOf(lists.brands, tags.brandId) ?? tags.brandText);
      setMatching(false);
      if (!r.ok) { setError(r.error); return; }
      setTags(r.value.tags); setRetailKeys(r.value.retailKeys); setMatched({ store: r.value.store, priceText: r.value.priceText }); setSheet(null);
      if (r.value.retailKeys.length) setSide("store");
    });
  }

  const [rotating, setRotating] = useState(false);
  function rotate() {
    setRotating(true); setError(undefined);
    start(async () => {
      const r = await rotateEntryAction(entry.id, "right");
      setRotating(false);
      if (!r.ok) { setError(r.error); return; }
      setPhotoKey(r.value.photoKey);
    });
  }

  const category = lists.categories.find((c) => c.id === tags.categoryId) ?? null;
  const subName = category ? nameOf(category.subcategories, tags.subcategoryId) : null;
  const categoryValue = category ? `${category.name}${subName ? ` · ${subName}` : ""}` : "Pick a category";
  const colorValue = tags.colorIds.map((id) => nameOf(lists.colors, id)).filter(Boolean).join(", ") || "Pick a color";
  const fabricName = nameOf(lists.fabrics, tags.fabricId);
  const fabricValue = fabricName ? `${fabricName}${tags.fabricConfidence < 0.6 ? " (best guess)" : ""}` : "Not sure";
  const seasonValue = tags.seasonIds.map((id) => nameOf(lists.seasons, id)).filter(Boolean).join(", ") || "Any";
  const formalityValue = nameOf(lists.formalities, tags.formalityId) ?? "Not set";
  const brandName = nameOf(lists.brands, tags.brandId) ?? tags.brandText;
  const brandValue = brandName || tags.sizeText ? [brandName, tags.sizeText].filter(Boolean).join(" · ") : "Scan the label";

  function edit(patch: ItemEdits) {
    const next = { ...tags, ...applyLocal(tags, patch) };
    setTags(next);
    start(async () => { const r = await saveEditsAction(entry.id, patch); if (r.ok) setTags(r.value); });
  }

  function confirm() {
    setError(undefined);
    start(async () => {
      const r = await confirmEntryAction(batchId, entry.id, {
        name: tags.name, categoryId: tags.categoryId, subcategoryId: tags.subcategoryId, colorIds: tags.colorIds, patternId: tags.patternId,
        fabricId: tags.fabricId, seasonIds: tags.seasonIds, formalityId: tags.formalityId, brandId: tags.brandId, brandText: tags.brandText, sizeText: tags.sizeText,
      });
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  }
  // Skip goes at once; the next card says "Skipped · Undo" for a few seconds (Q1).
  const skippedKey = `fc:skipped:${batchId}`;
  function skip() { try { window.sessionStorage.setItem(skippedKey, JSON.stringify({ id: entry.id, name: tags.name })); } catch { /* private mode */ } start(async () => { await skipEntryAction(batchId, entry.id); router.refresh(); }); }
  const [skipped, setSkipped] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(skippedKey);
      if (!raw) return;
      window.sessionStorage.removeItem(skippedKey);
      const last = JSON.parse(raw) as { id: string; name: string };
      if (last.id === entry.id) return;
      setSkipped(last);
      const t = setTimeout(() => setSkipped(null), 5000);
      return () => clearTimeout(t);
    } catch { /* ignore */ }
  }, [entry.id, skippedKey]);
  function unskip() {
    if (!skipped) return;
    const id = skipped.id; setSkipped(null);
    start(async () => { const r = await unskipEntryAction(batchId, id); if (!r.ok) { setError(r.error); return; } router.push(`/add/${batchId}?entry=${id}`); router.refresh(); });
  }
  function merge() { if (!duplicate) return; start(async () => { const r = await mergeEntryAction(batchId, entry.id, duplicate.itemId); if (!r.ok) { setError(r.error); return; } router.refresh(); }); }

  async function onPhoto(kind: "label" | "worn" | "back", e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(kind); setError(undefined); setSheet(null);
    try {
      const blob = await shrinkPhoto(file);
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: kind === "label" ? "labels" : kind === "worn" ? "worn" : "originals" }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const r = await attachPhotoAction(entry.id, kind, signed.key);
      if (!r.ok) throw new Error(r.error);
      if (kind === "label") { setLabelKey(signed.key); if (r.value) setTags(r.value); }
      else if (kind === "back") { setBackKey(signed.key); setSide("back"); if (r.value) setTags(r.value); }
      else setWornKey(signed.key);
    } catch (err) {
      setError((err as Error).message);
    } finally { setUploading(null); }
  }

  const bgFailed = entry.warnings.some((w) => w.startsWith("bg_failed"));

  return (
    <div className="flex flex-1 flex-col">
      <input ref={labelRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto("label", e)} data-testid="label-photo" />
      <input ref={wornRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto("worn", e)} data-testid="worn-photo" />
      <input ref={backRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto("back", e)} data-testid="back-photo" />

      <div className="flex h-14 items-center justify-between px-2">
        <Link href="/add" aria-label="Close, progress is saved" className="flex size-11 items-center justify-center text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M5 5l14 14M19 5 5 19" /></svg>
        </Link>
        <span className="mono mono-11 px-2.5 py-1.5" data-testid="confirm-counter">{counter}</span>
        <button type="button" onClick={skip} disabled={pending} className="pill pill-sm pill-quiet" data-testid="skip-entry">Skip</button>
      </div>

      <div className="flex items-end justify-between px-5 pb-3">
        <Title name={tags.name} />
        <button type="button" onClick={() => setSheet("rename")} className="pill pill-sm">Rename</button>
      </div>

      <div className="relative mx-5 h-[400px] bg-bone">
        <img src={`/api/photo/${shownKey}`} alt="" className="size-full object-contain" data-testid="confirm-photo" />
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/[0.12]"><div className="h-[3px] bg-ink" style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 px-5 pt-2" data-testid="photo-tools">
          <div className="flex flex-wrap gap-1.5">
            {backKey || retailKeys.length ? (
              <>
                <button type="button" onClick={() => setSide("front")} aria-pressed={side === "front"} className={`mono mono-11 h-9 px-3 ${side === "front" ? "bg-ink text-paper" : "border border-ink"}`} data-testid="photo-front">Front</button>
                {backKey ? <button type="button" onClick={() => setSide("back")} aria-pressed={side === "back"} className={`mono mono-11 h-9 px-3 ${side === "back" ? "bg-ink text-paper" : "border border-ink"}`} data-testid="photo-back">Back</button> : null}
                {retailKeys.length ? <button type="button" onClick={() => setSide("store")} aria-pressed={side === "store"} className={`mono mono-11 h-9 px-3 ${side === "store" ? "bg-ink text-paper" : "border border-ink"}`} data-testid="photo-store">Store</button> : null}
              </>
            ) : null}
          </div>
          {side === "front" ? (
            <button type="button" onClick={rotate} disabled={rotating || pending} className="pill pill-sm" data-testid="rotate" title="Turn the photo a quarter turn">{rotating ? "Turning…" : "Rotate ↻"}</button>
          ) : null}
        </div>

      {duplicate ? (
        <div className="mx-5 mt-3 flex items-center justify-between border-y border-ink py-2.5" data-testid="duplicate-row">
          <span className="mono tracking-[0.1em]">{mirrored ? `Details copied from ${duplicate.name ?? "it"} · check the color` : "Looks like one you own"}</span>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-[30px] overflow-hidden bg-bone">{duplicate.thumbKey ? <img src={`/api/photo/${duplicate.thumbKey}`} alt={duplicate.name ?? "Item you own"} className="size-full object-cover" /> : null}</div>
            <button type="button" onClick={() => setAskLike(true)} disabled={pending} className="pill pill-sm" data-testid="same-piece">Same?</button>
          </div>
        </div>
      ) : null}

      {bgFailed ? <p className="mono mx-5 mt-3 text-graphite">Background could not be removed · the original photo is used</p> : null}
      {skipped ? <UndoStrip text={`Skipped · ${skipped.name}`} onUndo={unskip} testId="skipped-undo" className="mx-5 mt-3" /> : null}

      {askMore && !backKey && !labelKey && !wornKey ? (
        <div className="mx-5 mt-3 border-y border-ink py-2.5" data-testid="ask-more-photos">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] leading-snug">Now the back<span className="mono block text-graphite">So the mirror can show the fit from behind</span></span>
            <div className="flex shrink-0 gap-1.5">
              <button type="button" onClick={() => backRef.current?.click()} className="pill pill-sm" data-testid="more-back">Add the back</button>
              <button type="button" onClick={() => setAskMore(false)} className="pill pill-sm pill-quiet" data-testid="more-no">Not now</button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="mono text-graphite">Also:</span>
            <button type="button" onClick={() => labelRef.current?.click()} className="pill pill-sm pill-quiet" data-testid="more-label">Label</button>
            <button type="button" onClick={() => wornRef.current?.click()} className="pill pill-sm pill-quiet" data-testid="more-worn">Worn</button>
          </div>
        </div>
      ) : null}

      {myBrands.length > 0 && !tags.brandId ? (
        <div className="mx-5 mt-3" data-testid="my-brand-pills">
          <p className="mono text-graphite">Your brands</p>
          <div className="-mx-5 mt-1.5 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {myBrands.map((b) => {
              const size = sizeFor(b, tags.categoryId);
              return <button key={b.brandId} type="button" onClick={() => edit({ brandId: b.brandId, brandText: b.name, ...(size ? { sizeText: size } : {}) })} className="pill pill-sm shrink-0" data-testid={`my-brand-${b.brandId}`}>{b.name}{size ? ` · ${size}` : ""}</button>;
            })}
            <button type="button" onClick={() => setSheet("brand")} className="pill pill-sm pill-quiet shrink-0">Other…</button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col px-5">
        <Row label="Category" value={categoryValue} muted={!category} onClick={() => setSheet("category")} testId="row-category" />
        <Row label="Color" value={colorValue} muted={!tags.colorIds.length} onClick={() => setSheet("color")} testId="row-color" />
        <Row label="Fabric" value={fabricValue} muted={!fabricName} onClick={() => setSheet("fabric")} />
        <Row label="Season" value={seasonValue} onClick={() => setSheet("season")} />
        <Row label="Dress code" value={formalityValue} muted={!tags.formalityId} onClick={() => setSheet("formality")} />
        <Row label="Brand · Size" value={brandValue} muted={!brandName && !tags.sizeText} onClick={() => setSheet("brand")} testId="row-brand" />
      {brandName ? <Row label="Find it online" value={matched ? `${matched.store}${matched.priceText ? ` · ${matched.priceText}` : ""} · store photos added` : `Match the style at ${brandName} · details + store photos`} muted={!matched} onClick={() => setSheet("match")} testId="match-style" /> : null}
      </div>

      {error ? <div className="px-5 pt-3"><Banner tone="danger" title={error} /></div> : null}
      {uploading ? <p className="mono px-5 pt-3 text-graphite">{uploading === "label" ? "Reading the label…" : uploading === "back" ? "Reading front and back…" : "Saving the photo…"}</p> : null}
      {labelKey || wornKey || backKey ? <p className="mono px-5 pt-3 text-graphite" data-testid="photo-status">{[backKey ? "Back photo added" : null, labelKey ? "Label photo added" : null, wornKey ? "Worn photo added" : null].filter(Boolean).join(" · ")}</p> : null}

      {/* The one action stays in reach: pinned to the bottom of the screen, above the home bar. */}
      <div className="sticky bottom-0 z-10 mt-auto flex items-center gap-2.5 border-t border-line bg-paper px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3" data-testid="confirm-bar">
        <Button size="lg" className="flex-1 justify-start" shelf={false} icon={<Icons.check />} sub={readyCount > 1 ? "Saves it · next photo" : "Saves it to your closet"} onClick={confirm} disabled={pending || Boolean(uploading)} data-testid="confirm-next">
          {pending ? "Saving…" : readyCount > 1 ? "Looks right · Next" : "Looks right · Done"}
        </Button>
        <button type="button" onClick={() => setSheet("camera")} aria-label="Add a label or worn photo" className="flex size-[60px] shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper text-ink active:bg-bone">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
        </button>
      </div>

      {/* Sheets */}
      <PickSheet open={sheet === "category"} onClose={() => setSheet(null)} title="Category" kind="category" options={lists.categories} selected={tags.categoryId ? [tags.categoryId] : []} canAdd={canEditLists}
        onChange={(ids) => { edit({ categoryId: ids[0] ?? null, subcategoryId: null }); if (ids[0] && (lists.categories.find((c) => c.id === ids[0])?.subcategories.length ?? 0) > 0) setSheet("subcategory"); }}
        onAdded={(e) => setLists((l) => ({ ...l, categories: [...l.categories, { ...e, subcategories: [] }] }))} />
      <PickSheet open={sheet === "subcategory"} onClose={() => setSheet(null)} title={category ? `${category.name} · type` : "Type"} kind="subcategory" parentId={category?.id} options={category?.subcategories ?? []} selected={tags.subcategoryId ? [tags.subcategoryId] : []} canAdd={canEditLists}
        onChange={(ids) => edit({ subcategoryId: ids[0] ?? null })}
        onAdded={(e) => setLists((l) => ({ ...l, categories: l.categories.map((c) => (c.id === category?.id ? { ...c, subcategories: [...c.subcategories, e] } : c)) }))} />
      <PickSheet open={sheet === "color"} onClose={() => setSheet(null)} title="Color" kind="color" options={lists.colors} selected={tags.colorIds} multi canAdd={canEditLists}
        onChange={(ids) => edit({ colorIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, colors: [...l.colors, e] }))} />
      <PickSheet open={sheet === "fabric"} onClose={() => setSheet(null)} title="Fabric" kind="fabric" options={lists.fabrics} selected={tags.fabricId ? [tags.fabricId] : []} canAdd={canEditLists}
        onChange={(ids) => edit({ fabricId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, fabrics: [...l.fabrics, e] }))} />
      <PickSheet open={sheet === "season"} onClose={() => setSheet(null)} title="Season" kind="season" options={lists.seasons} selected={tags.seasonIds} multi canAdd={canEditLists}
        onChange={(ids) => edit({ seasonIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, seasons: [...l.seasons, e] }))} />
      <PickSheet open={sheet === "formality"} onClose={() => setSheet(null)} title="Dress code" kind="formality" options={lists.formalities} selected={tags.formalityId ? [tags.formalityId] : []} canAdd={canEditLists}
        onChange={(ids) => edit({ formalityId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, formalities: [...l.formalities, e] }))} />
      <Sheet open={sheet === "brand" && !brandPicking} onClose={() => setSheet(null)} title="Brand · Size">
        <div className="flex flex-col">
          <BrandRows lists={lists} tags={tags} canAdd={canEditLists} picking={brandPicking} setPicking={setBrandPicking} onBrand={(id, text) => edit({ brandId: id, brandText: text })} onSize={() => setSheet("size")} onScan={() => labelRef.current?.click()} onAdded={(e) => setLists((l) => ({ ...l, brands: [...l.brands, e] }))} />
        </div>
      </Sheet>
      <TextSheet open={sheet === "size"} onClose={() => setSheet("brand")} title="Size" label="Size" value={tags.sizeText ?? ""} placeholder="M · 28 · 8 · EU 38" onSave={(v) => edit({ sizeText: v })} />
      <BrandSearch open={sheet === "brand" && brandPicking} onClose={() => setBrandPicking(false)} brands={lists.brands} selectedId={tags.brandId} onPick={(b) => { edit({ brandId: b.id, brandText: b.name }); setSheet(null); }} onAdded={(e) => setLists((l) => ({ ...l, brands: [...l.brands, e] }))} />
      <MatchSheet open={sheet === "match"} onClose={() => setSheet(null)} busy={matching || pending} onPick={pickMatch}
        probe={{ brand: brandName ?? "", name: tags.name, category: nameOf(lists.categories, tags.categoryId), color: tags.colorIds[0] ? nameOf(lists.colors, tags.colorIds[0]) : null }} />
      <TextSheet open={sheet === "rename"} onClose={() => setSheet(null)} title="Rename" label="Name" value={tags.name} onSave={(v) => edit({ name: v })} />
      <Sheet open={sheet === "camera"} onClose={() => setSheet(null)} title="Add a photo">
        <div className="flex flex-col">
          <button type="button" onClick={() => labelRef.current?.click()} className="flex h-12 items-center justify-between border-b border-line text-[15px]">Scan the label<span className="mono text-graphite">Brand · size</span></button>
          <button type="button" onClick={() => backRef.current?.click()} className="flex h-12 items-center justify-between border-b border-line text-[15px]" data-testid="add-back">Back of the piece<span className="mono text-graphite">Graphic · cut</span></button>
          <button type="button" onClick={() => wornRef.current?.click()} className="flex h-12 items-center justify-between border-b border-line text-[15px]">Worn photo<span className="mono text-graphite">How it fits</span></button>
        </div>
      </Sheet>
      {/* Another one like a piece you own: copy its details, add the photo to it, or start fresh */}
      <Sheet open={askLike && Boolean(duplicate)} onClose={dismissLike} title="Another one like this?">
        {duplicate ? (
          <div className="flex flex-col gap-4" data-testid="like-sheet">
            <div className="grid grid-cols-2 gap-3">
              <figure><div className="h-[150px] overflow-hidden bg-bone"><img src={`/api/photo/${photoKey}`} alt="" className="size-full object-contain" /></div><figcaption className="mono mt-1.5 text-graphite">This photo</figcaption></figure>
              <figure><div className="h-[150px] overflow-hidden bg-bone">{duplicate.thumbKey ? <img src={`/api/photo/${duplicate.thumbKey}`} alt="" className="size-full object-contain" /> : null}</div><figcaption className="mono mt-1.5 truncate text-graphite">{duplicate.name ?? "What you own"}</figcaption></figure>
            </div>
            <Button size="lg" className="w-full justify-start" shelf={false} icon={<Icons.copy />} sub="Copies its details · you check the color" onClick={mirror} data-testid="like-mirror">Another one of these</Button>
            <button type="button" onClick={() => { dismissLike(); merge(); }} className="pill h-[50px] w-full" data-testid="like-merge">It&apos;s the one I have · add this photo</button>
            <button type="button" onClick={dismissLike} className="pill pill-quiet h-[50px] w-full" data-testid="like-new">No · something new</button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

function BrandRows({ lists, tags, canAdd, picking, setPicking, onBrand, onSize, onScan, onAdded }: {
  lists: TagLists; tags: TagResult; canAdd: boolean; picking: boolean; setPicking: (v: boolean) => void; onBrand: (id: string | null, text: string | null) => void; onSize: () => void; onScan: () => void; onAdded: (e: Named) => void;
}) {
  const brandName = nameOf(lists.brands, tags.brandId) ?? tags.brandText;
  return (
    <>
      <Row label="Brand" value={brandName ?? "Pick a brand"} muted={!brandName} onClick={() => setPicking(true)} />
      <Row label="Size" value={tags.sizeText ?? "Add a size"} muted={!tags.sizeText} onClick={onSize} />
      <button type="button" onClick={onScan} className="pill mt-4 h-[50px]">Scan the label</button>
    </>
  );
}

/** Mirrors applyEdits for instant feedback; the server copy is authoritative. */
function applyLocal(tags: TagResult, p: ItemEdits): Partial<TagResult> {
  const out: Partial<TagResult> = {};
  if (p.name !== undefined) out.name = p.name.trim() || tags.name;
  if (p.categoryId !== undefined) out.categoryId = p.categoryId;
  if (p.subcategoryId !== undefined) out.subcategoryId = p.subcategoryId;
  if (p.colorIds !== undefined) out.colorIds = p.colorIds;
  if (p.patternId !== undefined) out.patternId = p.patternId;
  if (p.fabricId !== undefined) { out.fabricId = p.fabricId; out.fabricConfidence = 1; }
  if (p.seasonIds !== undefined) out.seasonIds = p.seasonIds;
  if (p.formalityId !== undefined) out.formalityId = p.formalityId;
  if (p.brandId !== undefined) out.brandId = p.brandId;
  if (p.brandText !== undefined) out.brandText = p.brandText;
  if (p.sizeText !== undefined) out.sizeText = p.sizeText?.trim() || null;
  return out;
}
