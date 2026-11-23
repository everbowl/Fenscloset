"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Sheet } from "@/components/ui/sheet";
import { PickSheet, TextSheet } from "@/components/items/row-editor";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { monoDate, monoMonth } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { FitDay, FitView } from "@/lib/fits/service";
import { deleteFitAction, rateFitAction, saveFitAction, setFitPhotoAction, setFitTitleAction, setFitViewersAction } from "./actions";
import { RatingRow } from "./rating-row";

type ClosetPiece = { id: string; name: string; thumbKey: string | null; categoryName: string | null };

/** "Sat, Oct 18" from the mono date "SAT, OCT 18": sentence case, as v2 reads. */
const dateWords = (key: string) => monoDate(key).toLowerCase().replace(/(^|[\s,])([a-z])/g, (m) => m.toUpperCase());
const monthWords = (year: number, month0: number) => { const s = monoMonth(year, month0).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const sentence = (s: string) => s.length ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
const LOST = "Lost the connection. Try again.";

/** Fits (screen 05, v2): the month as a grid of worn looks, the chosen day's fit as a card with the photo of the night, its pieces, who sees it, and the actions. */
export function FitsScreen(p: {
  year: number; month0: number; today: string; selected: string; days: FitDay[]; fits: FitView[];
  scope: "family" | "person"; personId: string; personName: string; canDress: boolean;
  people: { id: string; name: string }[]; closet: ClosetPiece[];
  /** Saved looks (B1): things to buy and things owned, together; the open one is reached from + New look. */
  looks: { id: string; name: string; pieces: number; toBuy: number }[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const setError = (e?: string) => { if (e) toast.error(e); };
  const [sheet, setSheet] = useState<{ kind: "share" | "title" | "pick" | "remove"; fitId?: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickTitle, setPickTitle] = useState("");
  const [pickCat, setPickCat] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const photoFor = useRef<string | null>(null);

  const first = new Date(Date.UTC(p.year, p.month0, 1)).getUTCDay();
  const count = new Date(Date.UTC(p.year, p.month0 + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: count }, (_, i) => `${p.year}-${String(p.month0 + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const monthKey = (delta: number) => { const d = new Date(Date.UTC(p.year, p.month0 + delta, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const byDay = new Map<string, FitDay[]>();
  for (const d of p.days) byDay.set(d.date, [...(byDay.get(d.date) ?? []), d]);

  /** One tap, one answer: a thrown action (the phone went to sleep mid-request) is an error with words, never a stuck button (review D 6.7). */
  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(undefined); setBusy(label);
    start(async () => {
      let r: { ok: boolean; error?: string };
      try { r = await fn(); } catch { r = { ok: false, error: LOST }; }
      setBusy(null);
      if (!r.ok) setError(r.error); else after?.();
      router.refresh();
    });
  }
  async function uploadPhoto(fitId: string, f: File) {
    setBusy("photo"); setError(undefined);
    try {
      const blob = await shrinkPhoto(f, 1600);
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: "fits", ownerId: p.personId }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const r = await setFitPhotoAction(fitId, signed.key);
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(null); }
  }

  const selectedFits = p.fits;
  const canSaveHere = p.canDress && p.selected <= p.today;
  const categories = ["All", ...Array.from(new Set(p.closet.map((c) => c.categoryName).filter(Boolean) as string[]))];

  return (
    <div data-testid="fits" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="lg:col-span-2"><PageHeader title="Fits" aside={
        <span className="flex items-center gap-1 text-ink">
          <Link href={`/fits?m=${monthKey(-1)}`} aria-label="Previous month" className="pill pill-sm px-2.5"><ChevronLeft className="size-4" strokeWidth={2} /></Link>
          <span className="text-[15px] font-semibold text-ink" data-testid="month-label">{monthWords(p.year, p.month0)}</span>
          <Link href={`/fits?m=${monthKey(1)}`} aria-label="Next month" className="pill pill-sm px-2.5"><ChevronRight className="size-4" strokeWidth={2} /></Link>
          {p.selected !== p.today ? <Link href={`/fits?d=${p.today}`} replace className="pill pill-sm ml-1" data-testid="fits-today">Today</Link> : null}
        </span>
      } /></div>
      {p.scope === "person" ? (
        <section className="mb-5 lg:col-span-2" data-testid="looks-row">
          <div className="flex items-center justify-between">
            <h2 className="section">Looks{p.looks.length ? ` · ${p.looks.length}` : ""}</h2>
            {p.canDress ? <Link href={`/looks/new?for=${p.personId}`} className="pill pill-sm" data-testid="new-look">+ New look</Link> : null}
          </div>
          {p.looks.length ? (
            <div className="strip -mx-5 mt-3 snap-x gap-2 px-5 pb-1 lg:mx-0 lg:px-0">
              {p.looks.map((l) => (
                <Link key={l.id} href={`/looks/${l.id}`} className="card tap flex w-[168px] shrink-0 snap-start flex-col gap-1 p-3" data-testid="look-card">
                  <span className="truncate text-[15px] font-semibold">{l.name}</span>
                  <span className="caption">{l.pieces} {l.pieces === 1 ? "piece" : "pieces"}{l.toBuy ? ` · ${l.toBuy} to buy` : ""}</span>
                </Link>
              ))}
            </div>
          ) : <p className="note mt-1">Things to buy and things you own, together on you. Tap Add to a look on a store find.</p>}
        </section>
      ) : null}
      <div className="lg:col-start-1">
        <div className="grid grid-cols-7 pb-1 text-center">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="caption">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1" data-testid="calendar">
          {cells.map((day, i) => {
            if (!day) return <div key={i} className="h-[46px] lg:h-[84px]" />;
            const fitsOn = byDay.get(day) ?? [];
            const img = fitsOn[0]?.thumbKey ?? fitsOn[0]?.photoKey ?? null; // the small cutout, not the full photo of the night, in a 46px cell
            const isToday = day === p.today, isSel = day === p.selected;
            return (
              <Link key={i} href={`/fits?m=${monthKey(0)}&d=${day}`} replace scroll={false} aria-label={day} aria-current={isSel ? "date" : undefined}
                className={cn("tap relative h-[46px] overflow-hidden rounded-xl lg:h-[84px]", fitsOn.length ? "stage" : "bg-paper", isSel && "ring-2 ring-inset ring-ink")} data-testid={fitsOn.length ? "day-with-fit" : undefined}>
                {img ? <img src={`/api/photo/${img}`} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" /> : null}
                <span className={cn("absolute left-1 top-1 flex size-6 items-center justify-center rounded-full text-[12px] font-semibold", isToday ? "bg-ink text-paper" : fitsOn.length ? "bg-paper text-ink" : "text-graphite")}>{Number(day.slice(8))}</span>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="mt-5 lg:col-start-2 lg:mt-0">
        {selectedFits.length ? selectedFits.map((f) => (
          <section key={f.id} className="card mb-4 flex flex-col gap-3 p-4" data-testid="fit-panel">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="caption">{dateWords(f.date)}{p.scope === "family" ? ` · ${f.ownerName}` : ""}</p>
                {f.canEdit ? <button type="button" onClick={() => setSheet({ kind: "title", fitId: f.id })} className="section text-left" data-testid="fit-title">{f.title.trim()}</button> : <p className="section">{f.title.trim()}</p>}
              </div>
              {f.canEdit ? <button type="button" onClick={() => setSheet({ kind: "share", fitId: f.id })} className="pill pill-sm shrink-0" data-testid="share">Who sees it</button> : null}
            </div>
            <div className="grid grid-cols-3 grid-rows-[112px_112px] gap-1.5">
              <div className="stage col-span-2 row-span-2 overflow-hidden">
                {f.photoKey ? <img src={`/api/photo/${f.photoKey}`} alt="Photo from the night" className="size-full object-cover" /> : (
                  <button type="button" disabled={!f.canEdit || busy === "photo"} onClick={() => { photoFor.current = f.id; file.current?.click(); }} className="tap flex size-full flex-col items-center justify-center gap-2 rounded-2xl" data-testid="photo-empty">
                    <Camera className="size-6 text-ink" strokeWidth={1.5} aria-hidden />
                    <span className="caption text-ink">{busy === "photo" ? "Saving…" : f.canEdit ? "Add a photo" : "No photo yet"}</span>
                  </button>
                )}
              </div>
              {f.pieces.slice(0, 2).map((x) => <div key={x.id} className="stage overflow-hidden">{x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt={x.name} className="size-full object-contain p-1.5" /> : <div className="flex size-full items-end p-2"><span className="caption">{x.name}</span></div>}</div>)}
              {f.pieces.length < 2 ? Array.from({ length: 2 - f.pieces.length }, (_, i) => <div key={i} className="stage" />) : null}
            </div>
            {f.pieces.length > 2 ? <p className="caption">{f.pieces.map((x) => sentence(x.label)).join(" · ")}</p> : null}
            <p className="caption" data-testid="visibility">{f.visibility}</p>
            {f.canEdit && f.date <= p.today ? <RatingRow rating={f.rating} disabled={busy !== null} onRate={(r) => run("rate", () => rateFitAction(f.id, r))} /> : null}
            {f.canEdit ? (
              // One orange thing: the photo of the night while there is none, else changing the pieces. The other is a quiet pill.
              f.photoKey ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-[50px]" disabled={busy !== null} onClick={() => { setPicked(f.pieces.map((x) => x.id)); setPickTitle(f.title); setSheet({ kind: "pick", fitId: f.id }); }} data-testid="save-the-fit">Change pieces</Button>
                  <button type="button" className="pill h-[50px]" disabled={busy !== null} onClick={() => { photoFor.current = f.id; file.current?.click(); }} data-testid="add-photo">Change photo</button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-[50px]" busy={busy === "photo"} disabled={busy !== null} onClick={() => { photoFor.current = f.id; file.current?.click(); }} data-testid="add-photo">{busy === "photo" ? "Saving…" : "Add photo"}</Button>
                  <button type="button" className="pill h-[50px]" disabled={busy !== null} onClick={() => { setPicked(f.pieces.map((x) => x.id)); setPickTitle(f.title); setSheet({ kind: "pick", fitId: f.id }); }} data-testid="save-the-fit">Change pieces</button>
                </div>
              )
            ) : null}
            {f.canEdit ? <div className="flex justify-between"><button type="button" onClick={() => setSheet({ kind: "remove", fitId: f.id })} className="pill pill-sm pill-quiet">Remove fit</button>{f.photoKey ? <button type="button" onClick={() => run("photo", () => setFitPhotoAction(f.id, null), () => toast.ok("Photo removed"))} className="pill pill-sm pill-quiet">Remove photo</button> : null}</div> : null}
          </section>
        )) : (
          <section className="card flex flex-col gap-3 p-4" data-testid="fit-empty">
            <p className="caption">{dateWords(p.selected)}{p.scope === "family" ? "" : ` · ${p.personName}`}</p>
            <p className="section">Nothing yet</p>
            <div className="stage flex h-[160px] items-center justify-center"><span className="caption">{canSaveHere ? "Nothing worn this day yet" : "Nothing saved this day"}</span></div>
            {canSaveHere ? (
              <Button className="h-[50px] w-full" onClick={() => { setPicked([]); setPickTitle(""); setSheet({ kind: "pick" }); }} data-testid="save-the-fit">Save the fit</Button>
            ) : <p className="note">{p.scope === "family" ? "No fits shared with you on this day." : p.selected > p.today ? "That day hasn’t happened yet." : `${p.personName} didn’t save a fit this day.`}</p>}
          </section>
        )}
      </div>

      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && photoFor.current) uploadPhoto(photoFor.current, f); e.target.value = ""; }} />

      {/* SAVE THE FIT: pick pieces from the closet, name it. */}
      <Sheet open={sheet?.kind === "pick"} onClose={() => setSheet(null)} title={sheet?.fitId ? "Change pieces" : "Save the fit"}
        footer={<Button className="w-full" busy={busy === "save"} disabled={busy !== null || picked.length === 0} onClick={() => run("save", () => saveFitAction(p.personId, p.selected, picked, pickTitle), () => { setSheet(null); toast.ok("Saved to Fits"); })} data-testid="confirm-save-fit">{busy === "save" ? "Saving…" : `Save the fit${picked.length ? ` · ${picked.length} ${picked.length === 1 ? "piece" : "pieces"}` : ""}`}</Button>}>
        <label className="caption block" htmlFor="fit-title">Name</label>
        <input id="fit-title" value={pickTitle} onChange={(e) => setPickTitle(e.target.value)} placeholder="Dinner out" maxLength={60} className="mb-4 h-11 w-full border-b border-line bg-transparent text-[17px] outline-none focus:border-ink" />
        <div className="strip -mx-5 mb-3 gap-2 px-5" role="tablist" aria-label="Category">
          {categories.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={(pickCat ?? "All") === c} onClick={() => setPickCat(c === "All" ? null : c)} className={cn("pill pill-sm shrink-0", (pickCat ?? "All") === c && "pill-on")}>{c}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5" role="listbox" aria-multiselectable>
          {p.closet.filter((c) => !pickCat || c.categoryName === pickCat).map((c) => {
            const on = picked.includes(c.id);
            return (
              <button key={c.id} type="button" role="option" aria-selected={on} onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])} className={cn("stage tap relative h-[112px] overflow-hidden", on && "ring-2 ring-inset ring-ink")} data-testid={`pick-${c.id}`}>
                {c.thumbKey ? <img src={`/api/photo/${c.thumbKey}`} alt={c.name} className="size-full object-contain p-1.5" /> : <span className="caption absolute bottom-1 left-1 right-1 truncate text-left">{c.name}</span>}
                {on ? <span className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-ink text-[12px] text-paper">✓</span> : null}
              </button>
            );
          })}
        </div>
        {p.closet.length === 0 ? <div className="flex flex-col items-start gap-3 py-4"><p className="note">Nothing in the closet yet</p><Link href="/add" className="pill">+ Add clothes</Link></div> : null}
      </Sheet>

      <PickSheet open={sheet?.kind === "share"} onClose={() => setSheet(null)} title="Who can see this fit" kind="tag" options={p.people} selected={selectedFits.find((f) => f.id === sheet?.fitId)?.viewerIds ?? []} multi canAdd={false} onChange={(ids) => run("share", () => setFitViewersAction(sheet!.fitId!, ids))} />
      <TextSheet open={sheet?.kind === "title"} onClose={() => setSheet(null)} title="Name this fit" label="Name" value={selectedFits.find((f) => f.id === sheet?.fitId)?.title ?? ""} onSave={(v) => run("title", () => setFitTitleAction(sheet!.fitId!, v))} />
      <Sheet open={sheet?.kind === "remove"} onClose={() => setSheet(null)} title="Remove this fit?">
        <p className="note">The pieces go back to their previous wear counts. The photo is deleted.</p>
        <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" className="pill pill-quiet h-[50px]" onClick={() => setSheet(null)}>Keep it</button><Button variant="danger" busy={busy === "remove"} disabled={busy !== null} onClick={() => run("remove", () => deleteFitAction(sheet!.fitId!), () => { setSheet(null); toast.ok("Fit removed"); })} data-testid="confirm-remove-fit">Remove</Button></div>
      </Sheet>
    </div>
  );
}
