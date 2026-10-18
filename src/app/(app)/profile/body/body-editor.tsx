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
import { addBodyPhotoAction, removeBodyPhotoAction, removeSizeAction, setFitNotesAction, setMeasurementAction, upsertSizeAction } from "../actions";

type Body = Omit<BodyProfileView, "photos"> & { photos: { id: string; key: string; takenAt: string }[] };

/**
 * Body profile (screen 11, undrawn): measurements from the editable list, sizes by brand, fit notes,
 * full-body photos, and the "VISIBLE TO …" line. Edits save in place.
 */
export function BodyEditor({ ownerId, ownerFirst, isMinor, body, brands, categories, canEdit, canEditLists, visibleTo }: {
  ownerId: string; ownerFirst: string; isMinor: boolean; body: Body; brands: Named[]; categories: Named[]; canEdit: boolean; canEditLists: boolean; visibleTo: string[];
}) {
  const router = useRouter();
  const [measuring, setMeasuring] = useState<{ kindId: string; name: string; unit: string; value: string } | null>(null);
  const [notes, setNotes] = useState(false);
  const [size, setSize] = useState<{ id?: string; brandId: string; categoryId: string | null; size: string } | null>(null);
  const [pickBrand, setPickBrand] = useState(false);
  const [pickCategory, setPickCategory] = useState(false);
  const [photoSheet, setPhotoSheet] = useState<string | null>(null);
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
      const r = await addBodyPhotoAction(ownerId, signed.key);
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
          <Row key={m.kindId} label={m.name} value={m.value ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "Add"} muted={!m.value} onClick={() => canEdit && setMeasuring({ kindId: m.kindId, name: m.name, unit: m.unit, value: m.value ?? "" })} testId={`measure-${m.name.toLowerCase().replace(/[^a-z]+/g, "-")}`} />
        ))}
        {canEditLists ? <div className="pt-2"><InlineAdd kind="measurementKind" label="Add a measurement" onCreated={() => router.refresh()} /></div> : null}
      </section>

      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Sizes by brand</p>
        {body.sizes.map((s) => (
          <Row key={s.id} label={s.brandName} value={`${s.size}${s.categoryName ? ` · ${s.categoryName}` : ""}`} onClick={() => canEdit && setSize({ id: s.id, brandId: s.brandId, categoryId: s.categoryId, size: s.size })} />
        ))}
        {body.sizes.length === 0 ? <p className="mono py-3 text-graphite">No sizes yet</p> : null}
        {canEdit ? <button type="button" onClick={() => setSize({ brandId: brandList[0]?.id ?? "", categoryId: null, size: "" })} className="mono mt-2 flex h-[46px] w-full items-center justify-center border border-ink" data-testid="add-size">Add a size</button> : null}
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
            <div className="grid grid-cols-3 gap-1.5 pt-2">
              {body.photos.map((p) => (
                <button key={p.id} type="button" onClick={() => canEdit && setPhotoSheet(p.id)} className="h-[150px] overflow-hidden bg-bone">
                  <img src={`/api/photo/${p.key}`} alt="Full-body photo" className="size-full object-cover" />
                </button>
              ))}
              {canEdit ? (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex h-[150px] flex-col items-center justify-center gap-2 bg-bone">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
                  <span className="mono">{uploading ? "Saving…" : "Add photo"}</span>
                </button>
              ) : null}
            </div>
            {body.photos.length === 0 && !canEdit ? <p className="mono py-3 text-graphite">No photos yet</p> : null}
          </>
        )}
      </section>

      {/* Sheets */}
      <TextSheet open={Boolean(measuring)} onClose={() => setMeasuring(null)} title={measuring?.name ?? ""} label={measuring?.unit ? `Value (${measuring.unit})` : "Value"} value={measuring?.value ?? ""} placeholder="e.g. 32" onSave={(v) => measuring && run(() => setMeasurementAction(ownerId, measuring.kindId, v))} />
      <TextSheet open={notes} onClose={() => setNotes(false)} title="Fit notes" label="Notes" value={body.fitNotes ?? ""} placeholder="Long arms · short torso · size up in jackets" onSave={(v) => run(() => setFitNotesAction(ownerId, v))} />
      <Sheet open={Boolean(size)} onClose={() => setSize(null)} title={size?.id ? "Edit size" : "Add a size"}>
        {size ? (
          <form onSubmit={(e) => { e.preventDefault(); const s = size; setSize(null); run(() => upsertSizeAction(ownerId, s)); }} className="space-y-4">
            <Row label="Brand" value={brandName(size.brandId)} onClick={() => setPickBrand(true)} />
            <Row label="For" value={categoryName(size.categoryId)} onClick={() => setPickCategory(true)} />
            <Field label="Size" htmlFor="size-value"><Input id="size-value" value={size.size} onChange={(e) => setSize({ ...size, size: e.target.value })} placeholder="M · 32 · 8 · EU 38" maxLength={20} autoFocus /></Field>
            <div className="flex gap-2.5">
              <Button type="submit" className="flex-1" disabled={pending || !size.brandId}>Save</Button>
              {size.id ? <Button type="button" variant="secondary" onClick={() => { const id = size.id!; setSize(null); run(() => removeSizeAction(ownerId, id)); }}>Remove</Button> : null}
            </div>
          </form>
        ) : null}
      </Sheet>
      <PickSheet open={pickBrand} onClose={() => setPickBrand(false)} title="Brand" kind="brand" options={brandList} selected={size?.brandId ? [size.brandId] : []} canAdd={canEditLists} onChange={(ids) => size && setSize({ ...size, brandId: ids[0] ?? "" })} onAdded={(e) => setBrandList((l) => [...l, e])} />
      <PickSheet open={pickCategory} onClose={() => setPickCategory(false)} title="For which category" kind="category" options={categories} selected={size?.categoryId ? [size.categoryId] : []} canAdd={false} onChange={(ids) => size && setSize({ ...size, categoryId: ids[0] ?? null })} />
      <Sheet open={Boolean(photoSheet)} onClose={() => setPhotoSheet(null)} title="This photo">
        <Button variant="secondary" className="w-full" disabled={pending} onClick={() => { const id = photoSheet!; setPhotoSheet(null); run(() => removeBodyPhotoAction(ownerId, id)); }}>Remove photo</Button>
      </Sheet>
    </div>
  );
}
