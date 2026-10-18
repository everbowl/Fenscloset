"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Banner } from "@/components/ui/banner";
import type { Named, TagLists, TagResult } from "@/lib/ai/tag-item";
import type { ItemEdits } from "@/lib/items/service";
import type { DuplicateHint } from "@/lib/items/duplicates";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { attachPhotoAction, confirmEntryAction, keepSmoothAction, mergeEntryAction, saveEditsAction, skipEntryAction, smoothEntryAction } from "./actions";
import { PickSheet, Row, TextSheet } from "@/components/items/row-editor";

type Props = {
  batchId: string;
  entry: { id: string; photoKey: string; labelKey: string | null; wornKey: string | null; backKey: string | null; smoothKey: string | null; warnings: string[] };
  canSmooth: boolean;
  tags: TagResult;
  lists: TagLists;
  counter: string;
  progress: number;
  duplicate: DuplicateHint | null;
  canEditLists: boolean;
  readyCount: number;
};

type SheetKind = "category" | "subcategory" | "color" | "fabric" | "season" | "formality" | "brand" | "size" | "rename" | "camera" | null;

function Title({ name }: { name: string }) {
  const words = name.trim().split(" ");
  const last = words.pop();
  return <h1 className="serif text-[34px]">{words.join(" ")}{words.length ? " " : ""}<em>{last}</em></h1>;
}

const nameOf = (xs: Named[], id: string | null) => xs.find((x) => x.id === id)?.name ?? null;

/** Design 03: one tap per item when the tags are right. */
export function ConfirmCard({ batchId, entry, tags: initial, lists: initialLists, counter, progress, duplicate, canEditLists, readyCount, canSmooth }: Props) {
  const router = useRouter();
  const [tags, setTags] = useState(initial);
  const [lists, setLists] = useState(initialLists);
  const [sheet, setSheet] = useState<SheetKind>(null);
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
  const [smoothKey, setSmoothKey] = useState(entry.smoothKey);
  const [smoothing, setSmoothing] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [side, setSide] = useState<"front" | "back">("front");
  const shownKey = side === "back" && backKey ? backKey : smoothKey && !showBefore ? smoothKey : photoKey;

  function smooth() {
    setError(undefined); setSmoothing(true); setSide("front"); setShowBefore(false);
    start(async () => {
      const r = await smoothEntryAction(entry.id);
      setSmoothing(false);
      if (!r.ok) { setError(r.error); return; }
      setSmoothKey(r.value.smoothKey);
    });
  }
  function decideSmooth(keep: boolean) {
    setError(undefined);
    start(async () => {
      const r = await keepSmoothAction(batchId, entry.id, keep);
      if (!r.ok) { setError(r.error); return; }
      setPhotoKey(r.value.photoKey); setSmoothKey(null); setShowBefore(false);
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
  function skip() { start(async () => { await skipEntryAction(batchId, entry.id); router.refresh(); }); }
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
      <input ref={labelRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto("label", e)} data-testid="label-photo" />
      <input ref={wornRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto("worn", e)} data-testid="worn-photo" />
      <input ref={backRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto("back", e)} data-testid="back-photo" />

      <div className="flex h-14 items-center justify-between px-2">
        <Link href="/add" aria-label="Close, progress is saved" className="flex size-11 items-center justify-center text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M5 5l14 14M19 5 5 19" /></svg>
        </Link>
        <span className="mono mono-11 px-2.5 py-1.5" data-testid="confirm-counter">{counter}</span>
        <button type="button" onClick={skip} disabled={pending} className="mono mono-11 p-3">Skip</button>
      </div>

      <div className="flex items-end justify-between px-5 pb-3">
        <Title name={tags.name} />
        <button type="button" onClick={() => setSheet("rename")} className="mono mono-11 py-2">Rename</button>
      </div>

      <div className="relative mx-5 h-[400px] bg-bone">
        <img src={`/api/photo/${shownKey}`} alt="" className="size-full object-contain" data-testid="confirm-photo" />
        {smoothing ? <span className="mono mono-11 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-paper px-3 py-2">Smoothing…</span> : null}
        {smoothKey && side === "front" ? <span className="mono mono-11 absolute left-2 top-2 bg-paper px-2.5 py-1.5">{showBefore ? "Before" : "Smoothed"}</span> : null}
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/[0.12]"><div className="h-[3px] bg-ink" style={{ width: `${progress}%` }} /></div>
      </div>

      {backKey || canSmooth ? (
        <div className="flex min-h-[44px] items-center justify-between px-5 pt-2" data-testid="photo-tools">
          <div className="flex gap-1.5">
            {backKey ? (
              <>
                <button type="button" onClick={() => setSide("front")} aria-pressed={side === "front"} className={`mono mono-11 h-9 px-3 ${side === "front" ? "bg-ink text-paper" : "border border-ink"}`} data-testid="photo-front">Front</button>
                <button type="button" onClick={() => setSide("back")} aria-pressed={side === "back"} className={`mono mono-11 h-9 px-3 ${side === "back" ? "bg-ink text-paper" : "border border-ink"}`} data-testid="photo-back">Back</button>
              </>
            ) : null}
          </div>
          {canSmooth && side === "front" ? (
            smoothKey ? (
              <div className="flex gap-1.5">
                <button type="button" onPointerDown={() => setShowBefore(true)} onPointerUp={() => setShowBefore(false)} onPointerLeave={() => setShowBefore(false)} onClick={() => setShowBefore((v) => !v)} className="mono mono-11 h-9 border border-ink px-3" data-testid="smooth-before">Before</button>
                <button type="button" onClick={() => decideSmooth(false)} disabled={pending} className="mono mono-11 h-9 border border-ink px-3" data-testid="smooth-undo">Undo</button>
                <button type="button" onClick={() => decideSmooth(true)} disabled={pending} className="mono mono-11 h-9 bg-ink px-3 text-paper" data-testid="smooth-keep">Keep</button>
              </div>
            ) : (
              <button type="button" onClick={smooth} disabled={smoothing || pending} className="mono mono-11 h-9 border border-ink px-3 disabled:opacity-60" data-testid="smooth">{smoothing ? "Smoothing…" : "Smooth wrinkles"}</button>
            )
          ) : null}
        </div>
      ) : null}

      {duplicate ? (
        <div className="mx-5 mt-3 flex items-center justify-between border-y border-ink py-2.5">
          <span className="mono tracking-[0.1em]">Looks like one you own</span>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-[30px] overflow-hidden bg-bone">{duplicate.thumbKey ? <img src={`/api/photo/${duplicate.thumbKey}`} alt={duplicate.name ?? "Item you own"} className="size-full object-cover" /> : null}</div>
            <button type="button" onClick={merge} disabled={pending} className="mono py-2 tracking-[0.1em]">Same?</button>
          </div>
        </div>
      ) : null}

      {bgFailed ? <p className="mono mx-5 mt-3 text-graphite">Background could not be removed · the original photo is used</p> : null}

      <div className="flex flex-col px-5">
        <Row label="Category" value={categoryValue} muted={!category} onClick={() => setSheet("category")} testId="row-category" />
        <Row label="Color" value={colorValue} muted={!tags.colorIds.length} onClick={() => setSheet("color")} testId="row-color" />
        <Row label="Fabric" value={fabricValue} muted={!fabricName} onClick={() => setSheet("fabric")} />
        <Row label="Season" value={seasonValue} onClick={() => setSheet("season")} />
        <Row label="Dress code" value={formalityValue} muted={!tags.formalityId} onClick={() => setSheet("formality")} />
        <Row label="Brand · Size" value={brandValue} muted={!brandName && !tags.sizeText} onClick={() => setSheet("brand")} testId="row-brand" />
      </div>

      {error ? <div className="px-5 pt-3"><Banner tone="danger" title={error} /></div> : null}
      {uploading ? <p className="mono px-5 pt-3 text-graphite">{uploading === "label" ? "Reading the label…" : uploading === "back" ? "Reading front and back…" : "Saving the photo…"}</p> : null}
      {labelKey || wornKey || backKey ? <p className="mono px-5 pt-3 text-graphite" data-testid="photo-status">{[backKey ? "Back photo added" : null, labelKey ? "Label photo added" : null, wornKey ? "Worn photo added" : null].filter(Boolean).join(" · ")}</p> : null}

      <div className="mt-auto flex gap-2.5 px-5 pb-[26px] pt-5">
        <button type="button" onClick={confirm} disabled={pending || Boolean(uploading)} data-testid="confirm-next" className="h-[54px] flex-1 bg-ink font-mono text-[12px] uppercase tracking-[0.16em] text-paper disabled:opacity-60">
          {pending ? "Saving…" : readyCount > 1 ? "Looks right · Next" : "Looks right · Done"}
        </button>
        <button type="button" onClick={() => setSheet("camera")} aria-label="Add a label or worn photo" className="flex size-[54px] items-center justify-center border border-ink bg-paper text-ink">
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
      <Sheet open={sheet === "brand"} onClose={() => setSheet(null)} title="Brand · Size">
        <div className="flex flex-col">
          <BrandRows lists={lists} tags={tags} canAdd={canEditLists} onBrand={(id, text) => edit({ brandId: id, brandText: text })} onSize={() => setSheet("size")} onScan={() => labelRef.current?.click()} onAdded={(e) => setLists((l) => ({ ...l, brands: [...l.brands, e] }))} />
        </div>
      </Sheet>
      <TextSheet open={sheet === "size"} onClose={() => setSheet("brand")} title="Size" label="Size" value={tags.sizeText ?? ""} placeholder="M · 28 · 8 · EU 38" onSave={(v) => edit({ sizeText: v })} />
      <TextSheet open={sheet === "rename"} onClose={() => setSheet(null)} title="Rename" label="Name" value={tags.name} onSave={(v) => edit({ name: v })} />
      <Sheet open={sheet === "camera"} onClose={() => setSheet(null)} title="Add a photo">
        <div className="flex flex-col">
          <button type="button" onClick={() => labelRef.current?.click()} className="flex h-12 items-center justify-between border-b border-line text-[15px]">Scan the label<span className="mono text-graphite">Brand · size</span></button>
          <button type="button" onClick={() => backRef.current?.click()} className="flex h-12 items-center justify-between border-b border-line text-[15px]" data-testid="add-back">Back of the piece<span className="mono text-graphite">Graphic · cut</span></button>
          <button type="button" onClick={() => wornRef.current?.click()} className="flex h-12 items-center justify-between border-b border-line text-[15px]">Worn photo<span className="mono text-graphite">How it fits</span></button>
        </div>
      </Sheet>
    </div>
  );
}

function BrandRows({ lists, tags, canAdd, onBrand, onSize, onScan, onAdded }: {
  lists: TagLists; tags: TagResult; canAdd: boolean; onBrand: (id: string | null, text: string | null) => void; onSize: () => void; onScan: () => void; onAdded: (e: Named) => void;
}) {
  const [picking, setPicking] = useState(false);
  const brandName = nameOf(lists.brands, tags.brandId) ?? tags.brandText;
  return (
    <>
      <Row label="Brand" value={brandName ?? "Pick a brand"} muted={!brandName} onClick={() => setPicking(true)} />
      <Row label="Size" value={tags.sizeText ?? "Add a size"} muted={!tags.sizeText} onClick={onSize} />
      <button type="button" onClick={onScan} className="mono mt-4 flex h-[46px] items-center justify-center border border-ink">Scan the label</button>
      <PickSheet open={picking} onClose={() => setPicking(false)} title="Brand" kind="brand" options={lists.brands} selected={tags.brandId ? [tags.brandId] : []} canAdd={canAdd}
        onChange={(ids) => onBrand(ids[0] ?? null, ids[0] ? (lists.brands.find((b) => b.id === ids[0])?.name ?? null) : null)} onAdded={onAdded} />
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
