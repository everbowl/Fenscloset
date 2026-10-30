"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { Button, buttonClass, Icons } from "@/components/ui/button";
import { PickSheet, PriceDateSheet, Row, TextSheet } from "@/components/items/row-editor";
import { BrandSearch } from "@/components/items/brand-search";
import { MatchSheet } from "@/components/items/match-sheet";
import { matchItemAction } from "@/lib/brands/actions";
import type { Product } from "@/lib/shop/products";
import { shrinkPhoto } from "@/lib/import/client-queue";
import type { ItemLists } from "@/lib/items/query";
import type { ItemDetailEdits } from "@/lib/items/service";
import type { LaundryStatus, PhotoKind } from "@/generated/prisma/client";
import { addItemPhotoAction, setLaundryAction, deleteItemAction, mirrorPhotoAction, notNowPhotoAction, removeItemPhotoAction, rotateItemPhotoAction, updateItemAction } from "./actions";
import { unretireAction } from "../clean-out/actions";
import { monoDate, prettyDate } from "@/lib/dates";
import { lastClosetUrl, markClosetRestore } from "@/lib/closet-memory";
import { FEATURE_KEYS, FEATURE_LABELS, isFeatureKey, mirrorCanPlace } from "@/lib/tryon/features";
import { MirrorSheet } from "@/components/mirror/mirror-sheet";
import { useMirror } from "@/components/mirror/use-mirror";
import type { MirrorConfig } from "@/lib/tryon/config";

export type ItemView = {
  id: string; name: string; ownerId: string; ownerName: string; mine: boolean; status: string; laundryStatus: LaundryStatus;
  isFavorite: boolean; neverSuggest: boolean; wearCount: number;
  categoryId: string | null; subcategoryId: string | null; colorIds: string[]; patternId: string | null; fabricId: string | null;
  seasonIds: string[]; formalityId: string | null; occasionIds: string[]; tagIds: string[]; brandId: string | null; storeId: string | null;
  size: string | null; purchasePrice: string | null; purchaseDate: string | null; purchaseUrl: string | null; fitNotes: string | null;
  /** How it is made (buttons down the front, long sleeves…): the mirror's styling chips key off these. */
  features: string[];
  closetIds: string[]; sharedWithIds: string[];
  photos: { id: string; kind: PhotoKind; key: string; isPrimary: boolean; /** The one the mirror dresses with (the person's choice). */ forMirror: boolean }[];
  lastWornAt: string | null;
  wearHistory: { wornOn: string; title: string | null }[];
  retired: { reason: string; at: string } | null;
  storePhoto: boolean;
  photoNudge: "first" | "refresh" | null;
};

type SheetKind = "category" | "subcategory" | "color" | "pattern" | "fabric" | "season" | "formality" | "occasion" | "tag" | "brand" | "match" | "store" | "size" | "price" | "url" | "notes" | "made" | "closets" | "share" | "rename" | "photo" | "delete" | null;

const LAUNDRY_WORD: Record<LaundryStatus, string> = { clean: "Clean", dirty: "In the wash", cleaners: "At cleaners" };
const KIND_WORD: Record<PhotoKind, string> = { alone: "Photo", worn: "Worn", label: "Label", cutout: "Cutout", thumb: "Thumb", back: "Back", retail: "Store" };

/** A yes/no row that reads as a switch: the word says the state, the pill flips it. */
function ToggleRow({ label, on, onWord, offWord, onChange, testId }: { label: string; on: boolean; onWord: string; offWord: string; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <div className="flex h-12 items-center border-b border-line">
      <span className="mono w-[120px] shrink-0 text-graphite">{label}</span>
      <span className="flex-1 text-[14px]">{on ? onWord : offWord}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cn("pill pill-sm", on && "pill-solid")} data-testid={testId}>{on ? "On" : "Off"}</button>
    </div>
  );
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

function Title({ name }: { name: string }) {
  const words = name.trim().split(" ");
  const last = words.pop();
  return <h1 className="serif text-[34px]">{words.join(" ")}{words.length ? " " : ""}<em>{last}</em></h1>;
}

/** Item detail: photo, serif title, mono meta, then every tag as a 42px row that edits in place. */
export function ItemEditor({ item, version, lists: initialLists, canEdit, canEditLists, mirror = null }: { item: ItemView; /** The server's updatedAt: when it changes (a save came back, a photo landed) the local copy takes the server's truth, without a remount that would close an open sheet. */ version: string; lists: ItemLists; canEdit: boolean; canEditLists: boolean; /** The signed-in person's mirror: "See it on me" dresses them in this one piece. */ mirror?: MirrorConfig | null }) {
  const router = useRouter();
  const [it, setIt] = useState(item);
  const m = useMirror(mirror?.personId ?? "", mirror?.wardrobe, mirror?.engine);
  const [lists, setLists] = useState(initialLists);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [brandPicking, setBrandPicking] = useState(false); // the brand search takes the sheet's place, never stacks on it
  const [photoIdx, setPhotoIdx] = useState(0);
  const setError = (e?: string) => { if (e) toast.error(e); };
  const [pending, start] = useTransition();
  // Take the server's copy once nothing is in flight (a tap in a multi-pick sheet while an earlier save is still saving must not be undone).
  useEffect(() => { if (!pending) setIt(item); }, [version, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoKind, setPhotoKind] = useState<"alone" | "worn" | "label" | "back">("alone");
  const [uploading, setUploading] = useState(false);
  const [matching, setMatching] = useState(false);
  function pickMatch(pick: Product) {
    setMatching(true); setError(undefined);
    start(async () => {
      const r = await matchItemAction(it.id, pick, name(lists.brands, it.brandId));
      setMatching(false);
      if (!r.ok) { setError(r.error); return; }
      const v = r.value;
      setIt((x) => ({ ...x, brandId: v.brandId, fitNotes: x.fitNotes ?? v.fitNotes, photos: [...x.photos.filter((p) => p.kind !== "retail"), ...v.photos.map((ph) => ({ id: ph.id, kind: "retail" as const, key: ph.key, isPrimary: false, forMirror: false }))] }));
      if (!lists.brands.some((b) => b.id === v.brandId)) setLists((l) => ({ ...l, brands: [...l.brands, { id: v.brandId, name: v.brandName }] }));
      setSheet(null); router.refresh();
    });
  }
  const [justAdded, setJustAdded] = useState(false);

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
  /** Laundry is three states, one tap each (it used to be a button that cycled through them). */
  function setLaundry(st: LaundryStatus) {
    const statusWordOf = (s: LaundryStatus, wearCount: number) => (s === "dirty" ? "In the wash" : s === "cleaners" ? "At cleaners" : wearCount > 0 ? `Worn ${wearCount}×` : "New");
    setIt((x) => ({ ...x, laundryStatus: st, status: statusWordOf(st, x.wearCount) }));
    start(async () => { const r = await setLaundryAction(it.id, st); if (!r.ok) { setError(r.error); router.refresh(); } });
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
      setJustAdded(true);
      router.refresh();
    } catch (err) { setError((err as Error).message); } finally { setUploading(false); }
  }

  const photo = it.photos[Math.min(photoIdx, it.photos.length - 1)] ?? null;
  const brandName = name(lists.brands, it.brandId);
  const price = it.purchasePrice ? `$${Number(it.purchasePrice).toFixed(2).replace(/\.00$/, "")}` : null;

  return (
    <div className="-mt-5 lg:mt-0 lg:grid lg:grid-cols-[440px_minmax(0,1fr)] lg:gap-x-12 lg:gap-y-0">
      <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} data-testid="item-photo" />
      {mirror ? <MirrorSheet m={m} pieces={it.name} mine personId={mirror.personId} personName={mirror.personName} tryOnState={mirror.tryOn} backPhoto={mirror.backPhoto} mannequinAvailable={mirror.mannequinAvailable} admin={mirror.admin} /> : null}
      <div className="relative -mx-5 h-[380px] bg-bone lg:mx-0 lg:h-[560px] lg:self-start lg:[grid-row:1/span_80]">
        {photo ? <img src={`/api/photo/${photo.key}`} alt={it.name} className="size-full object-contain" data-testid="item-hero" /> : null}
        {canEdit && photo ? (<>
          <button type="button" disabled={pending} onClick={() => start(async () => { const r = await rotateItemPhotoAction(it.id, photo.id); if (!r.ok) setError(r.error); else setIt((x) => ({ ...x, photos: x.photos.map((p) => (p.id === r.value.photoId ? { ...p, key: r.value.key } : p)) })); })} className="pill pill-sm absolute bottom-2 right-2" data-testid="rotate-photo" title="Turn the photo a quarter turn">Rotate ↻</button>
          {canEdit && photo.kind !== "worn" && photo.kind !== "label" ? <button type="button" disabled={pending} aria-pressed={photo.forMirror} onClick={() => start(async () => { const r = await mirrorPhotoAction(it.id, photo.id); if (!r.ok) setError(r.error); else setIt((x) => ({ ...x, photos: x.photos.map((p) => ({ ...p, forMirror: p.id === r.value.photoId })) })); })} className={`pill pill-sm absolute bottom-2 left-2 ${photo.forMirror ? "pill-solid" : ""}`} data-testid="mirror-photo" title="The mirror dresses you with this photo">{photo.forMirror ? "Mirror ✓" : "Use in mirror"}</button> : null}
        </>) : null}
        {photo?.kind === "retail" ? <span className="mono mono-11 absolute right-2 top-2 bg-paper px-2.5 py-1.5">Store photo</span> : photo?.kind === "worn" || photo?.kind === "back" ? <span className="mono mono-11 absolute right-2 top-2 bg-paper px-2.5 py-1.5">{KIND_WORD[photo.kind]}</span> : it.storePhoto && photo?.isPrimary ? <span className="mono mono-11 absolute right-2 top-2 bg-paper px-2.5 py-1.5">Store photo</span> : null}
      </div>
      {it.photos.length > 1 ? (
        <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pt-1.5 [scrollbar-width:none] lg:mx-0 lg:px-0 lg:pt-0">
          {it.photos.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setPhotoIdx(i)} aria-label={`${KIND_WORD[p.kind]} photo`} aria-pressed={i === photoIdx} className={`h-[62px] w-[48px] shrink-0 overflow-hidden bg-bone ${i === photoIdx ? "outline outline-2 -outline-offset-2 outline-ink" : ""}`}>
              <img src={`/api/photo/${p.key}`} alt="" className="size-full object-contain" />
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end justify-between pt-[18px]">
        <Title name={it.name} />
        {canEdit ? <button type="button" onClick={() => open("rename")} className="pill pill-sm">Rename</button> : null}
      </div>
      <p className="mono mt-2 text-graphite">{[!it.mine ? it.ownerName : null, category?.name, it.status, it.isFavorite ? "Favorite" : null].filter(Boolean).join(" · ")}</p>
      {/* This one piece in the mirror (Jeff, 19 Oct 2026, Q2 C): on you, or on the mannequin without a body photo. */}
      {mirror && (mirror.tryOn === "ready" || mirror.mannequinAvailable) && !it.retired && mirrorCanPlace(category?.name) ? (
        <Button variant="secondary" className="mt-3 w-full" disabled={m.busy} onClick={() => m.begin({ look: { kind: "closet", itemIds: [it.id] }, on: mirror.tryOn === "ready" ? "me" : "mannequin" })} data-testid="see-on-me">{m.busy ? "Dressing…" : mirror.tryOn === "ready" ? "See it on me" : "See it on a mannequin"}</Button>
      ) : null}
      {/* Shop v2 item 1 (Jeff, 23 Oct 2026): what would complete this piece, products for it, looks from the closet. */}
      {!it.retired ? <Link href={`/closet/${it.id}/go-with`} className={buttonClass({ variant: "secondary", className: "mt-3 w-full" })} data-testid="go-with">Shop for something to go with it</Link> : null}

      {justAdded ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-line py-2" data-testid="ask-more-photos">
          <span className="mono tracking-[0.1em]">Added · another?</span>
          {([["back", "Back"], ["label", "Label"], ["worn", "Worn"], ["alone", "Photo"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => { setPhotoKind(k); photoRef.current?.click(); }} className="pill pill-sm">{l}</button>)}
          <button type="button" onClick={() => setJustAdded(false)} className="pill pill-sm pill-quiet">Done</button>
        </div>
      ) : null}
      {canEdit && it.photoNudge && !it.retired ? (
        <div className="mt-3 flex items-center justify-between border-y border-ink py-2.5" data-testid="photo-nudge">
          <span className="mono tracking-[0.1em]">{it.photoNudge === "first" ? "Worn once · add a photo of your own?" : `Worn ${it.wearCount}× · time for a fresh photo?`}</span>
          <div className="flex gap-3">
            <button type="button" onClick={() => { setPhotoKind("alone"); photoRef.current?.click(); }} className="pill" data-testid="nudge-add">Add photo</button>
            <button type="button" disabled={pending} onClick={() => start(async () => { const r = await notNowPhotoAction(it.id); if (!r.ok) setError(r.error); else { setIt((x) => ({ ...x, photoNudge: null })); router.refresh(); } })} className="pill pill-quiet" data-testid="nudge-later">Not now</button>
          </div>
        </div>
      ) : null}
      {it.retired ? (
        <div className="mt-3 flex items-center justify-between border-y border-ink py-2.5" data-testid="retired-strip">
          <span className="mono tracking-[0.1em]">Retired · {it.retired.reason === "sell" ? "to sell" : "to donate"}</span>
          {canEdit ? <button type="button" disabled={pending} onClick={() => start(async () => { const r = await unretireAction(it.id); if (!r.ok) setError(r.error); else { setIt((x) => ({ ...x, retired: null })); router.refresh(); } })} className="pill">Bring it back</button> : null}
        </div>
      ) : null}
      {canEdit && !it.retired ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-ink py-2.5" data-testid="laundry-row">
          <span className="mono tracking-[0.1em]">Laundry</span>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Laundry">
            {(["clean", "dirty", "cleaners"] as const).map((st) => (
              <button key={st} type="button" role="radio" aria-checked={it.laundryStatus === st} disabled={pending || it.laundryStatus === st} onClick={() => setLaundry(st)} className={cn("pill pill-sm", it.laundryStatus === st && "pill-solid disabled:opacity-100")} data-testid={`laundry-${st}`}>{LAUNDRY_WORD[st]}</button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col">
        <Row label="Category" value={category ? `${category.name}${sub ? ` · ${sub}` : ""}` : "Pick a category"} muted={!category} onClick={() => open("category")} testId="row-category" />
        <Row label="Color" value={names(lists.colors, it.colorIds) || "Pick a color"} muted={!it.colorIds.length} onClick={() => open("color")} />
        <Row label="Pattern" value={name(lists.patterns, it.patternId) ?? "Not set"} muted={!it.patternId} onClick={() => open("pattern")} testId="row-pattern" />
        <Row label="Fabric" value={name(lists.fabrics, it.fabricId) ?? "Not set"} muted={!it.fabricId} onClick={() => open("fabric")} />
        <Row label="Season" value={names(lists.seasons, it.seasonIds) || "Any"} onClick={() => open("season")} />
        <Row label="Dress code" value={name(lists.formalities, it.formalityId) ?? "Not set"} muted={!it.formalityId} onClick={() => open("formality")} />
        <Row label="Occasions" value={names(lists.occasions, it.occasionIds) || "Any"} onClick={() => open("occasion")} />
        <Row label="Tags" value={names(lists.tags, it.tagIds) || "Not set"} muted={!it.tagIds.length} onClick={() => open("tag")} />
        <Row label="Brand · Size" value={[brandName, it.size].filter(Boolean).join(" · ") || "Not set"} muted={!brandName && !it.size} onClick={() => open("brand")} />
        <Row label="Store" value={name(lists.stores, it.storeId) ?? "Not set"} muted={!it.storeId} onClick={() => open("store")} />
        <Row label="Price · Date" value={[price, it.purchaseDate ? prettyDate(it.purchaseDate) : null].filter(Boolean).join(" · ") || "Not set"} muted={!price && !it.purchaseDate} onClick={() => open("price")} testId="row-price" />
        <Row label="Link" value={it.purchaseUrl ? hostOf(it.purchaseUrl) : "Not set"} muted={!it.purchaseUrl} onClick={() => open("url")} testId="row-link"
          trailing={it.purchaseUrl ? <a href={it.purchaseUrl} target="_blank" rel="noreferrer" className="pill pill-sm shrink-0" data-testid="open-link">Open ↗</a> : undefined} />
        <Row label="Fit notes" value={it.fitNotes ?? "Not set"} muted={!it.fitNotes} onClick={() => open("notes")} />
        <Row label="Made with" value={it.features.filter(isFeatureKey).map((f) => FEATURE_LABELS[f]).join(" · ") || "Not set"} muted={!it.features.length} onClick={() => open("made")} testId="row-made" />
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
        <Row label="Shared with" value={names(lists.people, it.sharedWithIds) || "No one else"} muted={!it.sharedWithIds.length} onClick={() => open("share")} />
        {canEdit ? (
          <>
            <ToggleRow label="Favorite" on={it.isFavorite} onWord="Yes" offWord="No" onChange={(v) => save({ isFavorite: v }, { isFavorite: v })} testId="toggle-favorite" />
            <ToggleRow label="Suggest it" on={!it.neverSuggest} onWord="Yes" offWord="Never" onChange={(v) => save({ neverSuggest: !v }, { neverSuggest: !v })} testId="toggle-suggest" />
          </>
        ) : null}
      </div>
      {canEdit && !it.retired ? <div className="pt-6"><button type="button" onClick={() => setSheet("delete")} className="pill pill-sm pill-quiet" data-testid="delete-piece">Delete this piece</button></div> : null}

      {uploading ? <p className="mono pt-3 text-graphite" role="status">Saving the photo…</p> : null}

      {canEdit ? (
        <div className="pt-5">
          <Button size="lg" className="w-full" onClick={() => setSheet("photo")} busy={uploading} icon={<Icons.camera />} sub={it.photos.length ? "Back, label, worn, or another shot" : "A hanger or flat-lay shot is enough"}>{uploading ? "Saving the photo…" : "Add photo"}</Button>
        </div>
      ) : null}

      {/* Sheets */}
      <PickSheet open={sheet === "category"} onClose={() => setSheet(null)} title="Category" kind="category" options={lists.categories} selected={it.categoryId ? [it.categoryId] : []} canAdd={canEditLists}
        onChange={(ids) => { save({ categoryId: ids[0] ?? null, subcategoryId: null }, { categoryId: ids[0] ?? null, subcategoryId: null }); if (ids[0] && (lists.categories.find((c) => c.id === ids[0])?.subcategories.length ?? 0) > 0) setSheet("subcategory"); }}
        onAdded={(e) => setLists((l) => ({ ...l, categories: [...l.categories, { ...e, subcategories: [] }] }))} />
      <PickSheet clearable open={sheet === "subcategory"} onClose={() => setSheet(null)} title={category ? `${category.name} · type` : "Type"} kind="subcategory" parentId={category?.id} options={category?.subcategories ?? []} selected={it.subcategoryId ? [it.subcategoryId] : []} canAdd={canEditLists}
        onChange={(ids) => save({ subcategoryId: ids[0] ?? null }, { subcategoryId: ids[0] ?? null })}
        onAdded={(e) => setLists((l) => ({ ...l, categories: l.categories.map((c) => (c.id === category?.id ? { ...c, subcategories: [...c.subcategories, e] } : c)) }))} />
      <PickSheet open={sheet === "color"} onClose={() => setSheet(null)} title="Color" kind="color" options={lists.colors} selected={it.colorIds} multi canAdd={canEditLists} onChange={(ids) => save({ colorIds: ids }, { colorIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, colors: [...l.colors, e] }))} />
      <PickSheet clearable open={sheet === "pattern"} onClose={() => setSheet(null)} title="Pattern" kind="pattern" options={lists.patterns} selected={it.patternId ? [it.patternId] : []} canAdd={canEditLists} onChange={(ids) => save({ patternId: ids[0] ?? null }, { patternId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, patterns: [...l.patterns, e] }))} />
      <PickSheet clearable open={sheet === "fabric"} onClose={() => setSheet(null)} title="Fabric" kind="fabric" options={lists.fabrics} selected={it.fabricId ? [it.fabricId] : []} canAdd={canEditLists} onChange={(ids) => save({ fabricId: ids[0] ?? null }, { fabricId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, fabrics: [...l.fabrics, e] }))} />
      <PickSheet open={sheet === "season"} onClose={() => setSheet(null)} title="Season" kind="season" options={lists.seasons} selected={it.seasonIds} multi canAdd={canEditLists} onChange={(ids) => save({ seasonIds: ids }, { seasonIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, seasons: [...l.seasons, e] }))} />
      <PickSheet clearable open={sheet === "formality"} onClose={() => setSheet(null)} title="Dress code" kind="formality" options={lists.formalities} selected={it.formalityId ? [it.formalityId] : []} canAdd={canEditLists} onChange={(ids) => save({ formalityId: ids[0] ?? null }, { formalityId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, formalities: [...l.formalities, e] }))} />
      <PickSheet open={sheet === "occasion"} onClose={() => setSheet(null)} title="Occasions" kind="occasion" options={lists.occasions} selected={it.occasionIds} multi canAdd={canEditLists} onChange={(ids) => save({ occasionIds: ids }, { occasionIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, occasions: [...l.occasions, e] }))} />
      <PickSheet open={sheet === "tag"} onClose={() => setSheet(null)} title="Tags" kind="tag" options={lists.tags} selected={it.tagIds} multi canAdd={canEditLists} onChange={(ids) => save({ tagIds: ids }, { tagIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, tags: [...l.tags, e] }))} />
      <Sheet open={sheet === "brand" && !brandPicking} onClose={() => setSheet(null)} title="Brand · Size">
        <div className="flex flex-col">
          <Row label="Brand" value={brandName ?? "Pick a brand"} muted={!brandName} onClick={() => setBrandPicking(true)} />
          {brandName ? <Row label="Find it online" value={it.photos.some((p) => p.kind === "retail") ? "Store photos added · match again" : `Match the style at ${brandName} · details + store photos`} muted={!it.photos.some((p) => p.kind === "retail")} onClick={() => setSheet("match")} testId="match-style" /> : null}
          <Row label="Size" value={it.size ?? "Add a size"} muted={!it.size} onClick={() => setSheet("size")} />
          <button type="button" onClick={() => { setPhotoKind("label"); photoRef.current?.click(); }} className="pill mt-4 h-[50px]">Add a label photo</button>
        </div>
      </Sheet>
      <PickSheet clearable open={sheet === "store"} onClose={() => setSheet(null)} title="Store" kind="store" options={lists.stores} selected={it.storeId ? [it.storeId] : []} canAdd={canEditLists} onChange={(ids) => save({ storeId: ids[0] ?? null }, { storeId: ids[0] ?? null })} onAdded={(e) => setLists((l) => ({ ...l, stores: [...l.stores, e] }))} />
      <PickSheet open={sheet === "closets"} onClose={() => setSheet(null)} title="Closets" kind="closet" options={lists.closets.map((c) => ({ id: c.id, name: c.kind === "family" ? `${c.name} (everyone)` : c.name }))} selected={it.closetIds} multi canAdd={canEditLists} onChange={(ids) => save({ closetIds: ids }, { closetIds: ids })} onAdded={(e) => setLists((l) => ({ ...l, closets: [...l.closets, { ...e, kind: "custom" }] }))} />
      <PickSheet open={sheet === "share"} onClose={() => setSheet(null)} title="Share with" kind="tag" options={lists.people} selected={it.sharedWithIds} multi canAdd={false} onChange={(ids) => save({ sharedWithIds: ids }, { sharedWithIds: ids })} />
      <TextSheet open={sheet === "size"} onClose={() => setSheet("brand")} title="Size" label="Size" value={it.size ?? ""} placeholder="M · 28 · 8 · EU 38" onSave={(v) => save({ sizeText: v }, { size: v.trim() || null })} />
      <BrandSearch open={sheet === "brand" && brandPicking} onClose={() => setBrandPicking(false)} brands={lists.brands} selectedId={it.brandId} onPick={(b) => save({ brandId: b.id }, { brandId: b.id })} onAdded={(e) => setLists((l) => ({ ...l, brands: [...l.brands, e] }))} />
      <MatchSheet open={sheet === "match"} onClose={() => setSheet("brand")} busy={matching || pending} onPick={pickMatch}
        probe={{ brand: brandName ?? "", name: it.name, category: category?.name ?? null, color: it.colorIds[0] ? name(lists.colors, it.colorIds[0]) : null }} />
      <TextSheet open={sheet === "rename"} onClose={() => setSheet(null)} title="Rename" label="Name" value={it.name} onSave={(v) => save({ name: v }, { name: v.trim() || it.name })} />
      <PriceDateSheet open={sheet === "price"} onClose={() => setSheet(null)} price={it.purchasePrice ?? ""} date={it.purchaseDate ?? ""}
        onSave={({ price: pr, date }) => save({ purchasePrice: pr, purchaseDate: date }, { purchasePrice: pr.replace(/[$,\s]/g, "") || null, purchaseDate: date.trim() || null })} />
      <TextSheet open={sheet === "url"} onClose={() => setSheet(null)} title="Link" label="Where you bought it" kind="url" value={it.purchaseUrl ?? ""} placeholder="https://" onSave={(v) => save({ purchaseUrl: v }, { purchaseUrl: v.trim() || null })} />
      {/* How the piece is made: the mirror offers Buttons / Sleeves / Hood chips only when a piece in the look has them. */}
      <Sheet open={sheet === "made"} onClose={() => setSheet(null)} title="Made with">
        <p className="mono mb-3 text-graphite">The mirror asks how to show these: buttons open, sleeves rolled, hood up.</p>
        <div className="flex flex-col" role="listbox" aria-multiselectable>
          {FEATURE_KEYS.map((f) => {
            const on = it.features.includes(f);
            return (
              <button key={f} type="button" role="option" aria-selected={on} onClick={() => { const next = on ? it.features.filter((x) => x !== f) : [...it.features, f]; save({ features: next }, { features: next }); }} className="flex h-12 items-center justify-between border-b border-line text-[15px]" data-testid={`made-${f}`}>
                <span>{FEATURE_LABELS[f]}</span>
                <span className={cn("mono", on ? "text-ink" : "text-transparent")}>{on ? "✓" : "·"}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end"><Button type="button" size="md" onClick={() => setSheet(null)}>Done</Button></div>
      </Sheet>
      <TextSheet open={sheet === "notes"} onClose={() => setSheet(null)} title="Fit notes" label="How it fits" kind="multiline" value={it.fitNotes ?? ""} placeholder="Runs small · long in the arms" onSave={(v) => save({ fitNotes: v }, { fitNotes: v.trim() || null })} />
      <Sheet open={sheet === "photo"} onClose={() => setSheet(null)} title="Add a photo">
        <div className="flex flex-col">
          {([["alone", "Another photo", "Hanger or flat-lay"], ["back", "Back of the piece", "Graphic · cut"], ["worn", "Worn photo", "How it fits"], ["label", "Label", "Brand · size"]] as const).map(([k, l, m]) => (
            <button key={k} type="button" onClick={() => { setPhotoKind(k); photoRef.current?.click(); }} className="flex h-12 items-center justify-between border-b border-line text-[15px]">{l}<span className="mono text-graphite">{m}</span></button>
          ))}
          {it.photos.length > 1 && photo ? (
            <button type="button" onClick={() => start(async () => { const r = await removeItemPhotoAction(it.id, photo.id); if (!r.ok) setError(r.error); setSheet(null); setPhotoIdx(0); router.refresh(); })} className="pill mt-5 h-[50px]">Remove the photo shown</button>
          ) : null}
        </div>
      </Sheet>
      <Sheet open={sheet === "delete"} onClose={() => setSheet(null)} title="Delete this piece?">
        <p className="text-[14px] leading-snug">It leaves every closet and its photos are removed. This can&apos;t be undone.</p>
        <div className="mt-5 flex gap-2.5">
          <button type="button" className="pill pill-quiet h-[50px] flex-1" onClick={() => setSheet(null)}>Keep it</button>
          <Button variant="danger" className="flex-1" disabled={pending} data-testid="confirm-delete" onClick={() => start(async () => { const r = await deleteItemAction(it.id); if (!r.ok) { setError(r.error); setSheet(null); return; } markClosetRestore(); router.push(lastClosetUrl() ?? "/closet"); router.refresh(); })}>Delete</Button>
        </div>
      </Sheet>
    </div>
  );
}

