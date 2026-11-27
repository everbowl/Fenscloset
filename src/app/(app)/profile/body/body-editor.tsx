"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Row, TextSheet } from "@/components/items/row-editor";
import { ReadRow } from "@/components/profile/read-row";
import { InlineAdd } from "@/components/lists/inline-add";
import type { BodyProfileView } from "@/lib/profiles/service";
import { SizeSheet } from "@/components/profile/size-sheet";
import { PhotoPrivacySheet, useBodyPhotoUpload, type BodyPhotoView } from "@/components/profile/body-photo-upload";
import { formatMeasurement, measurementOptions, type LikelySizes } from "@/lib/profiles/size-options";
import { monoDate } from "@/lib/dates";
import { removeBodyPhotoAction, setBodyPhotoPrivacyAction, setFitNotesAction, setMeasurementAction } from "../actions";

type Body = Omit<BodyProfileView, "photos"> & { photos: { id: string; key: string; takenAt: string; onlyMe: boolean; view: BodyPhotoView }[] };

/**
 * Body profile (screen 11, undrawn): measurements from the editable list, sizes by brand, fit notes,
 * full-body photos, and the "VISIBLE TO …" line. Edits save in place.
 */
export function BodyEditor({ ownerId, ownerFirst, isMinor, body, likely, canEdit, canEditLists, visibleTo }: {
  ownerId: string; ownerFirst: string; isMinor: boolean; body: Body; likely: LikelySizes | null; canEdit: boolean; canEditLists: boolean; visibleTo: string[];
}) {
  const router = useRouter();
  const [measuring, setMeasuring] = useState<{ kindId: string; name: string; unit: string; value: string } | null>(null);
  const [notes, setNotes] = useState(false);
  const [photoSheet, setPhotoSheet] = useState<string | null>(null);
  const [confirmPhoto, setConfirmPhoto] = useState(false); // a body photo asks before it goes (Q1)
  const [askPrivacy, setAskPrivacy] = useState(false);
  const [nextView, setNextView] = useState<BodyPhotoView>("front");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const upload = useBodyPhotoUpload(ownerId, () => router.refresh());

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    start(async () => { const r = await fn(); if (!r.ok) setError(r.error); router.refresh(); });
  }

  return (
    <div className="space-y-6">
      {upload.input}
      <p className="caption -mt-2">Visible to {visibleTo.join(", ")}{isMinor ? " only" : ""}{!canEdit ? " · read-only for you" : ""}</p>
      {error ?? upload.error ? <Banner tone="danger" title={error ?? upload.error ?? ""} /> : null}

      <section>
        <h2 className="section">Measurements</h2>
        <div className="card mt-3 px-4 pb-1">
          {/* A viewer with read access gets plain rows, never a tap that does nothing (review E G2). */}
          {body.measurements.map((m) => canEdit
            ? <Row key={m.kindId} label={m.name} value={m.value ? formatMeasurement(m, m.value) : "Add"} muted={!m.value} onClick={() => setMeasuring({ kindId: m.kindId, name: m.name, unit: m.unit, value: m.value ?? "" })} testId={`measure-${m.name.toLowerCase().replace(/[^a-z]+/g, "-")}`} />
            : <ReadRow key={m.kindId} label={m.name} value={m.value ? formatMeasurement(m, m.value) : "Not set"} muted={!m.value} testId={`measure-${m.name.toLowerCase().replace(/[^a-z]+/g, "-")}`} />)}
          {canEditLists ? <div className="py-2"><InlineAdd kind="measurementKind" label="Add a measurement" onCreated={() => router.refresh()} /></div> : null}
        </div>
        {likely ? (
          <p className="note mt-3" data-testid="likely-sizes">Likely sizes from height and weight: Tops {likely.letter} · Bottoms {likely.waist} · Dresses {likely.dress}. A starting point, not a measurement; set the real ones under Brands.</p>
        ) : !isMinor ? <p className="note mt-3">Add height and weight to see likely sizes.</p> : null}
      </section>

      {/* Sizes are edited in one place, the Brands page (the owner, 31 Oct 2026, P1); here they are read. */}
      <section data-testid="body-sizes">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section">Sizes by brand</h2>
          {canEdit ? <Link href="/profile/brands" className="pill pill-sm" data-testid="edit-sizes">Edit sizes <span aria-hidden>→</span></Link> : null}
        </div>
        <div className="card mt-3 divide-y divide-line overflow-hidden p-0">
          {body.sizes.map((s) => (
            <div key={s.id} className="flex min-h-12 items-center px-4 text-[15px]">
              <span className="mono w-[120px] shrink-0 truncate text-graphite">{s.brandName}</span>
              <span className="flex-1 truncate">{s.size}{s.categoryName ? ` · ${s.categoryName}` : ""}</span>
            </div>
          ))}
          {body.sizes.length === 0 ? <p className="note px-4 py-3">No sizes yet{canEdit ? ". Set them under Brands." : "."}</p> : null}
        </div>
      </section>

      <section>
        <h2 className="section">Fit notes</h2>
        {canEdit ? (
          <button type="button" onClick={() => setNotes(true)} className="card tap mt-3 flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-[15px]">
            <span className={body.fitNotes ? "" : "text-graphite"}>{body.fitNotes ?? "How things usually fit: long arms, short torso…"}</span>
            <span className="mono shrink-0 text-graphite">Edit</span>
          </button>
        ) : (
          <p className="card mt-3 min-h-12 px-4 py-3 text-[15px]">{body.fitNotes ?? <span className="text-graphite">No fit notes yet</span>}</p>
        )}
      </section>

      <section>
        <h2 className="section">Full-body photos</h2>
        {!body.photosAllowed ? (
          <p className="note py-3">Body photos need a parent&apos;s approval. A parent admin turns this on under People.</p>
        ) : (
          <>
            {isMinor && body.photosApprovedBy ? <p className="caption mt-2">Approved by {body.photosApprovedBy} · seen by {ownerFirst} and parents only</p> : null}
            <p className="note py-2" data-testid="body-tip">A plain fitted t-shirt and long pants, so the mirror has clothes to swap. Phone at chest height, plain wall, arms a little away from your sides. Retake them as your body changes; the newest of each view is the one used.</p>
            <div className="grid grid-cols-4 gap-1.5 pt-1" data-testid="body-slots">
              {(["front", "back", "left", "right"] as const).map((v) => {
                const p = body.photos.find((x) => x.view === v) ?? (v === "left" ? body.photos.find((x) => x.view === "side") : undefined); // newest first from the server
                const word = v[0].toUpperCase() + v.slice(1);
                const tile = <><img src={`/api/photo/${p?.key}`} alt={`${word} full-body photo`} className="size-full object-cover" /><span className="mono absolute bottom-1.5 left-1.5 rounded-full bg-paper px-2 py-1">{word} · {p ? monoDate(p.takenAt.slice(0, 10)) : ""}</span>{p?.onlyMe ? <span className="mono absolute left-1.5 top-1.5 rounded-full bg-paper px-2 py-1">Only me</span> : null}</>;
                return p ? (
                  canEdit
                    ? <button key={v} type="button" onClick={() => setPhotoSheet(p.id)} className="stage relative aspect-[3/4] overflow-hidden" data-testid={p.onlyMe ? "body-photo-locked" : "body-photo-shared"} data-view={v}>{tile}</button>
                    : <div key={v} className="stage relative aspect-[3/4] overflow-hidden" data-testid={p.onlyMe ? "body-photo-locked" : "body-photo-shared"} data-view={v}>{tile}</div>
                ) : canEdit ? (
                  <button key={v} type="button" onClick={() => { setNextView(v); setAskPrivacy(true); }} disabled={Boolean(upload.uploading)} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink bg-paper" data-testid={`add-body-photo-${v}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
                    <span className="mono">{upload.uploading === v ? "Saving…" : word}</span>
                  </button>
                ) : (
                  <div key={v} className="stage flex aspect-[3/4] items-center justify-center"><span className="caption">No {v}</span></div>
                );
              })}
            </div>
            {(() => {
              const newest = new Set((["front", "back", "left", "right", "side"] as const).map((v) => body.photos.find((x) => x.view === v)?.id).filter(Boolean));
              const older = body.photos.filter((x) => !newest.has(x.id));
              return older.length ? (
                <div className="pt-3" data-testid="body-history">
                  <p className="caption pb-1.5">Older photos · {older.length}</p>
                  <div className="strip gap-1.5">
                    {older.map((p) => canEdit ? (
                      <button key={p.id} type="button" onClick={() => setPhotoSheet(p.id)} className="stage relative h-[84px] w-[64px] shrink-0 overflow-hidden rounded-xl">
                        <img src={`/api/photo/${p.key}`} alt="" className="size-full object-cover" />
                        <span className="mono absolute bottom-1 left-1 rounded-full bg-paper px-1.5 py-0.5">{monoDate(p.takenAt.slice(0, 10))}</span>
                      </button>
                    ) : (
                      <div key={p.id} className="stage relative h-[84px] w-[64px] shrink-0 overflow-hidden rounded-xl">
                        <img src={`/api/photo/${p.key}`} alt="" className="size-full object-cover" />
                        <span className="mono absolute bottom-1 left-1 rounded-full bg-paper px-1.5 py-0.5">{monoDate(p.takenAt.slice(0, 10))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
            {body.photos.length === 0 && !canEdit ? <p className="note py-3">No photos yet</p> : null}
          </>
        )}
      </section>

      {/* Sheets */}
      <SizeSheet open={Boolean(measuring)} onClose={() => setMeasuring(null)} title={measuring?.name ?? ""} options={measuring ? measurementOptions(measuring) : []} value={measuring?.value || null} unit={measuring?.unit} format={measuring ? (v) => formatMeasurement(measuring, v) : undefined} testId="measure-sheet"
        onPick={(v) => measuring && run(() => setMeasurementAction(ownerId, measuring.kindId, v ?? ""))} />
      <TextSheet open={notes} onClose={() => setNotes(false)} title="Fit notes" label="Notes" value={body.fitNotes ?? ""} placeholder="Long arms · short torso · size up in jackets" onSave={(v) => run(() => setFitNotesAction(ownerId, v))} />
      <PhotoPrivacySheet open={askPrivacy} onClose={() => setAskPrivacy(false)} visibleTo={visibleTo} onPick={(onlyMe) => { setAskPrivacy(false); upload.pick(nextView, onlyMe); }} />
      <Sheet open={Boolean(photoSheet)} onClose={() => { setPhotoSheet(null); setConfirmPhoto(false); }} title={confirmPhoto ? "Remove this photo?" : "This photo"}>
        {(() => { const p = body.photos.find((x) => x.id === photoSheet); return p && confirmPhoto ? (
          <div data-testid="body-photo-confirm">
            <p className="note">The mirror stops using it. This can’t be undone.</p>
            <div className="mt-5 flex gap-2.5">
              <button type="button" className="pill pill-quiet h-[50px] flex-1" onClick={() => setConfirmPhoto(false)}>Keep it</button>
              <Button variant="danger" className="flex-1" disabled={pending} data-testid="body-photo-remove" onClick={() => { setPhotoSheet(null); setConfirmPhoto(false); run(() => removeBodyPhotoAction(ownerId, p.id)); }}>Remove</Button>
            </div>
          </div>
        ) : p ? (
          <div className="space-y-2.5">
            <p className="caption">{p.onlyMe ? "Locked · only you can see it" : `Seen by ${visibleTo.join(", ")}`}</p>
            <Button variant="secondary" className="w-full" disabled={pending} data-testid="retake-photo" onClick={() => { setPhotoSheet(null); setNextView(p.view === "side" ? "left" : p.view); setAskPrivacy(true); }}>Retake ({p.view === "side" ? "left" : p.view})</Button>
            <button type="button" className="pill h-[50px] w-full" disabled={pending} data-testid="toggle-photo-lock" onClick={() => { setPhotoSheet(null); run(() => setBodyPhotoPrivacyAction(ownerId, p.id, !p.onlyMe)); }}>{p.onlyMe ? "Unlock for my body-profile viewers" : "Lock to only me"}</button>
            <button type="button" className="pill pill-quiet h-[50px] w-full" disabled={pending} onClick={() => setConfirmPhoto(true)}>Remove photo</button>
          </div>
        ) : null; })()}
      </Sheet>
    </div>
  );
}
