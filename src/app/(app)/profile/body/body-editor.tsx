"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { PickSheet, Row, TextSheet } from "@/components/items/row-editor";
import { InlineAdd } from "@/components/lists/inline-add";
import { shrinkPhoto } from "@/lib/import/client-queue";
import type { BodyProfileView, Named } from "@/lib/profiles/service";
import { SizeSheet } from "@/components/profile/size-sheet";
import type { CategorySizes } from "@/lib/profiles/sizes";
import { formatMeasurement, likelyFor, measurementOptions, type LikelySizes } from "@/lib/profiles/size-options";
import { monoDate } from "@/lib/dates";
import { addBodyPhotoAction, removeBodyPhotoAction, removeSizeAction, setBodyPhotoPrivacyAction, setFitNotesAction, setMeasurementAction, upsertSizeAction } from "../actions";

type BodyView = "front" | "back" | "left" | "right" | "side";
type Body = Omit<BodyProfileView, "photos"> & { photos: { id: string; key: string; takenAt: string; onlyMe: boolean; view: BodyView }[] };

/**
 * Body profile (screen 11, undrawn): measurements from the editable list, sizes by brand, fit notes,
 * full-body photos, and the "VISIBLE TO …" line. Edits save in place.
 */
export function BodyEditor({ ownerId, ownerFirst, isMinor, body, brands, categories, sizeOptions, likely, canEdit, canEditLists, visibleTo }: {
  ownerId: string; ownerFirst: string; isMinor: boolean; body: Body; brands: Named[]; categories: Named[]; sizeOptions: CategorySizes[]; likely: LikelySizes | null; canEdit: boolean; canEditLists: boolean; visibleTo: string[];
}) {
  const router = useRouter();
  const [measuring, setMeasuring] = useState<{ kindId: string; name: string; unit: string; value: string } | null>(null);
  const [notes, setNotes] = useState(false);
  const [size, setSize] = useState<{ id?: string; brandId: string; categoryId: string | null; size: string } | null>(null);
  const [pickBrand, setPickBrand] = useState(false);
  const [pickCategory, setPickCategory] = useState(false);
  const [pickSize, setPickSize] = useState(false);
  const [photoSheet, setPhotoSheet] = useState<string | null>(null);
  const [askPrivacy, setAskPrivacy] = useState(false);
  const [nextOnlyMe, setNextOnlyMe] = useState(false);
  const [nextView, setNextView] = useState<BodyView>("front");
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [brandList, setBrandList] = useState(brands);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    start(async () => { const r = await fn(); if (!r.ok) setError(r.error); router.refresh(); });
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setUploading(true); setError(undefined);
    try {
      const blob = await shrinkPhoto(file);
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: "bodies", ownerId }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const r = await addBodyPhotoAction(ownerId, signed.key, nextOnlyMe, nextView);
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (err) { setError((err as Error).message); } finally { setUploading(false); }
  }

  const brandName = (id: string) => brandList.find((b) => b.id === id)?.name ?? "Pick a brand";
  const categoryName = (id: string | null) => (id ? categories.find((c) => c.id === id)?.name ?? "Any" : "Any");

  return (
    <div className="space-y-6">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} data-testid="body-photo" />
      <div className="flex items-center justify-between border-y border-ink py-2.5">
        <span className="mono tracking-[0.1em]">Visible to {visibleTo.join(", ")}{isMinor ? " only" : ""}</span>
      </div>
      {error ? <Banner tone="danger" title={error} /> : null}

      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Measurements</p>
        {body.measurements.map((m) => (
          <Row key={m.kindId} label={m.name} value={m.value ? formatMeasurement(m, m.value) : "Add"} muted={!m.value} onClick={() => canEdit && setMeasuring({ kindId: m.kindId, name: m.name, unit: m.unit, value: m.value ?? "" })} testId={`measure-${m.name.toLowerCase().replace(/[^a-z]+/g, "-")}`} />
        ))}
        {canEditLists ? <div className="pt-2"><InlineAdd kind="measurementKind" label="Add a measurement" onCreated={() => router.refresh()} /></div> : null}
        {likely ? (
          <p className="mono mt-3 text-graphite" data-testid="likely-sizes">Likely sizes from height and weight: Tops {likely.letter} · Bottoms {likely.waist} · Dresses {likely.dress}. A starting point, not a measurement; set the real ones under Brands.</p>
        ) : !isMinor ? <p className="mono mt-3 text-graphite">Add height and weight to see likely sizes.</p> : null}
      </section>

      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Sizes by brand</p>
        {body.sizes.map((s) => (
          <Row key={s.id} label={s.brandName} value={`${s.size}${s.categoryName ? ` · ${s.categoryName}` : ""}`} onClick={() => canEdit && setSize({ id: s.id, brandId: s.brandId, categoryId: s.categoryId, size: s.size })} />
        ))}
        {body.sizes.length === 0 ? <p className="mono py-3 text-graphite">No sizes yet</p> : null}
        {canEdit ? <button type="button" onClick={() => setSize({ brandId: brandList[0]?.id ?? "", categoryId: null, size: "" })} className="pill mt-2 h-[50px] w-full" data-testid="add-size">Add a size</button> : null}
      </section>

      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Fit notes</p>
        <button type="button" onClick={() => canEdit && setNotes(true)} className="flex min-h-[42px] w-full items-center justify-between border-b border-line py-2 text-left text-[14px]">
          <span className={body.fitNotes ? "" : "text-graphite"}>{body.fitNotes ?? "How things usually fit: long arms, short torso…"}</span>
          {canEdit ? <span className="mono ml-3 shrink-0 text-graphite">Edit</span> : null}
        </button>
      </section>

      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Full-body photos</p>
        {!body.photosAllowed ? (
          <p className="mono py-3 text-graphite">Body photos need a parent&apos;s approval. A parent admin turns this on under People.</p>
        ) : (
          <>
            {isMinor && body.photosApprovedBy ? <p className="mono py-2 text-graphite">Approved by {body.photosApprovedBy} · seen by {ownerFirst} and parents only</p> : null}
            <p className="mono py-2 normal-case text-graphite" data-testid="body-tip">Four photos: front, back, left, right. Wear a plain fitted t-shirt and long pants, not swimwear: the mirror swaps the clothes it can see on you, so it needs clothes to swap. Phone at chest height, plain wall, arms a little away from your sides. The mirror uses the front; the back shows how a piece fits from behind. Retake them as your body changes: the newest of each is used, the rest stay as history.</p>
            <div className="grid grid-cols-4 gap-1.5 pt-1" data-testid="body-slots">
              {(["front", "back", "left", "right"] as const).map((v) => {
                const p = body.photos.find((x) => x.view === v) ?? (v === "left" ? body.photos.find((x) => x.view === "side") : undefined); // newest first from the server
                const word = v[0].toUpperCase() + v.slice(1);
                return p ? (
                  <button key={v} type="button" onClick={() => canEdit && setPhotoSheet(p.id)} className="relative h-[150px] overflow-hidden bg-bone" data-testid={p.onlyMe ? "body-photo-locked" : "body-photo-shared"} data-view={v}>
                    <img src={`/api/photo/${p.key}`} alt={`${word} full-body photo`} className="size-full object-cover" />
                    <span className="mono absolute bottom-1.5 left-1.5 bg-paper px-1.5 py-1">{word} · {monoDate(p.takenAt.slice(0, 10))}</span>
                    {p.onlyMe ? <span className="mono absolute left-1.5 top-1.5 bg-paper px-1.5 py-1">Only me</span> : null}
                  </button>
                ) : canEdit ? (
                  <button key={v} type="button" onClick={() => { setNextView(v); setAskPrivacy(true); }} disabled={uploading} className="flex h-[150px] flex-col items-center justify-center gap-2 border border-dashed border-ink bg-paper" data-testid={`add-body-photo-${v}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
                    <span className="mono">{uploading && nextView === v ? "Saving…" : word}</span>
                  </button>
                ) : (
                  <div key={v} className="flex h-[150px] items-center justify-center bg-bone"><span className="mono text-graphite">No {v}</span></div>
                );
              })}
            </div>
            {(() => {
              const newest = new Set((["front", "back", "left", "right", "side"] as const).map((v) => body.photos.find((x) => x.view === v)?.id).filter(Boolean));
              const older = body.photos.filter((x) => !newest.has(x.id));
              return older.length ? (
                <div className="pt-3" data-testid="body-history">
                  <p className="mono pb-1.5 text-graphite">Older photos · {older.length}</p>
                  <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                    {older.map((p) => (
                      <button key={p.id} type="button" onClick={() => canEdit && setPhotoSheet(p.id)} className="relative h-[84px] w-[64px] shrink-0 overflow-hidden bg-bone">
                        <img src={`/api/photo/${p.key}`} alt="" className="size-full object-cover" />
                        <span className="mono absolute bottom-1 left-1 bg-paper px-1 py-0.5">{monoDate(p.takenAt.slice(0, 10))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
            {body.photos.length === 0 && !canEdit ? <p className="mono py-3 text-graphite">No photos yet</p> : null}
          </>
        )}
      </section>

      {/* Sheets */}
      <SizeSheet open={Boolean(measuring)} onClose={() => setMeasuring(null)} title={measuring?.name ?? ""} options={measuring ? measurementOptions(measuring) : []} value={measuring?.value || null} unit={measuring?.unit} format={measuring ? (v) => formatMeasurement(measuring, v) : undefined} testId="measure-sheet"
        onPick={(v) => measuring && run(() => setMeasurementAction(ownerId, measuring.kindId, v ?? ""))} />
      <SizeSheet open={pickSize} onClose={() => setPickSize(false)} title={size ? `${brandName(size.brandId)} · ${categoryName(size.categoryId)}` : ""} options={sizeOptions.find((c) => c.categoryId === size?.categoryId)?.options ?? []} value={size?.size || null} suggested={size?.categoryId ? likelyFor(likely, categoryName(size.categoryId)) : null}
        onPick={(v) => size && setSize({ ...size, size: v ?? "" })} />
      <TextSheet open={notes} onClose={() => setNotes(false)} title="Fit notes" label="Notes" value={body.fitNotes ?? ""} placeholder="Long arms · short torso · size up in jackets" onSave={(v) => run(() => setFitNotesAction(ownerId, v))} />
      <Sheet open={Boolean(size)} onClose={() => setSize(null)} title={size?.id ? "Edit size" : "Add a size"}>
        {size ? (
          <form onSubmit={(e) => { e.preventDefault(); const s = size; setSize(null); run(() => upsertSizeAction(ownerId, s)); }} className="space-y-4">
            <Row label="Brand" value={brandName(size.brandId)} onClick={() => setPickBrand(true)} />
            <Row label="For" value={categoryName(size.categoryId)} onClick={() => setPickCategory(true)} />
            {sizeOptions.some((c) => c.categoryId === size.categoryId)
              ? <Row label="Size" value={size.size || "Tap to pick"} muted={!size.size} onClick={() => setPickSize(true)} testId="size-pick" />
              : <Field label="Size" htmlFor="size-value"><Input id="size-value" value={size.size} onChange={(e) => setSize({ ...size, size: e.target.value })} placeholder="M · 32 · 8 · EU 38" maxLength={20} autoFocus /></Field>}
            <div className="flex gap-2.5">
              <Button type="submit" className="flex-1" disabled={pending || !size.brandId}>Save</Button>
              {size.id ? <Button type="button" variant="secondary" onClick={() => { const id = size.id!; setSize(null); run(() => removeSizeAction(ownerId, id)); }}>Remove</Button> : null}
            </div>
          </form>
        ) : null}
      </Sheet>
      <PickSheet open={pickBrand} onClose={() => setPickBrand(false)} title="Brand" kind="brand" options={brandList} selected={size?.brandId ? [size.brandId] : []} canAdd={canEditLists} onChange={(ids) => size && setSize({ ...size, brandId: ids[0] ?? "" })} onAdded={(e) => setBrandList((l) => [...l, e])} />
      <PickSheet open={pickCategory} onClose={() => setPickCategory(false)} title="For which category" kind="category" options={categories} selected={size?.categoryId ? [size.categoryId] : []} canAdd={false} onChange={(ids) => size && setSize({ ...size, categoryId: ids[0] ?? null })} />
      <Sheet open={askPrivacy} onClose={() => setAskPrivacy(false)} title="Who can see this photo?">
        <div className="flex flex-col">
          <button type="button" data-testid="photo-only-me" onClick={() => { setNextOnlyMe(true); setAskPrivacy(false); fileRef.current?.click(); }} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 text-left text-[15px]">
            <span>Only me<span className="mono block text-graphite">Nobody else, ever · the AI still uses it to dress you</span></span>
          </button>
          <button type="button" data-testid="photo-shared" onClick={() => { setNextOnlyMe(false); setAskPrivacy(false); fileRef.current?.click(); }} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 text-left text-[15px]">
            <span>Everyone who can see my body profile<span className="mono block text-graphite">Currently {visibleTo.join(", ")}</span></span>
          </button>
        </div>
      </Sheet>
      <Sheet open={Boolean(photoSheet)} onClose={() => setPhotoSheet(null)} title="This photo">
        {(() => { const p = body.photos.find((x) => x.id === photoSheet); return p ? (
          <div className="space-y-2.5">
            <p className="mono text-graphite">{p.onlyMe ? "Locked · only you can see it" : `Seen by ${visibleTo.join(", ")}`}</p>
            <Button variant="secondary" className="w-full" disabled={pending} data-testid="toggle-photo-lock" onClick={() => { setPhotoSheet(null); run(() => setBodyPhotoPrivacyAction(ownerId, p.id, !p.onlyMe)); }}>{p.onlyMe ? "Unlock for my body-profile viewers" : "Lock to only me"}</Button>
            <Button variant="secondary" className="w-full" disabled={pending} data-testid="retake-photo" onClick={() => { setPhotoSheet(null); setNextView(p.view === "side" ? "left" : p.view); setAskPrivacy(true); }}>Retake ({p.view === "side" ? "left" : p.view})</Button>
            <Button variant="secondary" className="w-full" disabled={pending} onClick={() => { setPhotoSheet(null); run(() => removeBodyPhotoAction(ownerId, p.id)); }}>Remove photo</Button>
          </div>
        ) : null; })()}
      </Sheet>
    </div>
  );
}
