"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Sheet } from "@/components/ui/sheet";
import { PickSheet, TextSheet } from "@/components/items/row-editor";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { monoDate, monoMonth } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { FitDay, FitView } from "@/lib/fits/service";
import { deleteFitAction, rateFitAction, saveFitAction, setFitPhotoAction, setFitTitleAction, setFitViewersAction } from "./actions";
import { RatingRow } from "./rating-row";

type ClosetPiece = { id: string; name: string; thumbKey: string | null; categoryName: string | null };

function Title({ title }: { title: string }) {
  const words = title.trim().split(" "); const last = words.pop();
  return <p className="serif text-[30px] leading-none">{words.join(" ")}{words.length ? " " : ""}<em>{last}</em></p>;
}

export function FitsScreen(p: {
  year: number; month0: number; today: string; selected: string; days: FitDay[]; fits: FitView[];
  scope: "family" | "person"; personId: string; personName: string; canDress: boolean;
  people: { id: string; name: string }[]; closet: ClosetPiece[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<{ kind: "share" | "title" | "pick" | "remove"; fitId?: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickTitle, setPickTitle] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const photoFor = useRef<string | null>(null);

  const first = new Date(Date.UTC(p.year, p.month0, 1)).getUTCDay();
  const count = new Date(Date.UTC(p.year, p.month0 + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: count }, (_, i) => `${p.year}-${String(p.month0 + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const monthKey = (delta: number) => { const d = new Date(Date.UTC(p.year, p.month0 + delta, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const byDay = new Map<string, FitDay[]>();
  for (const d of p.days) byDay.set(d.date, [...(byDay.get(d.date) ?? []), d]);

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(undefined); setBusy(label);
    start(async () => { const r = await fn(); setBusy(null); if (!r.ok) setError(r.error); else after?.(); router.refresh(); });
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

  return (
    <div data-testid="fits" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="lg:col-span-2"><PageHeader title="Fits" aside={
        <span className="flex items-center gap-0.5 text-ink">
          <Link href={`/fits?m=${monthKey(-1)}&d=${p.selected}`} aria-label="Previous month" className="flex size-9 items-center justify-center"><ChevronLeft className="size-3" strokeWidth={2} /></Link>
          <span data-testid="month-label">{monoMonth(p.year, p.month0)}</span>
          <Link href={`/fits?m=${monthKey(1)}&d=${p.selected}`} aria-label="Next month" className="flex size-9 items-center justify-center"><ChevronRight className="size-3" strokeWidth={2} /></Link>
        </span>
      } /></div>
      {error ? <Banner tone="danger" title={error} className="mb-3 lg:col-span-2" /> : null}
      <div className="lg:col-start-1">
      <div className="mono grid grid-cols-7 border-b border-ink pb-2 text-graphite">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-0.5 pt-1" data-testid="calendar">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="h-[46px]" />;
          const fitsOn = byDay.get(day) ?? [];
          const img = fitsOn[0]?.photoKey ?? fitsOn[0]?.thumbKey ?? null;
          const isToday = day === p.today, isSel = day === p.selected;
          return (
            <Link key={i} href={`/fits?m=${monthKey(0)}&d=${day}`} aria-label={day} aria-current={isSel ? "date" : undefined}
              className={cn("relative h-[46px] overflow-hidden lg:h-[84px]", fitsOn.length ? "bg-bone" : "bg-paper", isSel && "outline outline-2 -outline-offset-2 outline-ink")} data-testid={fitsOn.length ? "day-with-fit" : undefined}>
              {img ? <img src={`/api/photo/${img}`} alt="" className="absolute inset-0 size-full object-cover" /> : null}
              <span className={cn("mono absolute left-1 top-[3px] px-[3px] py-px", isToday ? "bg-ink text-paper" : fitsOn.length ? "bg-paper text-ink" : "text-ink")}>{Number(day.slice(8))}</span>
            </Link>
          );
        })}
      </div>

      </div>
      <div className="mt-[18px] border-t border-ink pt-4 lg:col-start-2 lg:mt-0 lg:border-t-0 lg:pt-0">
        {selectedFits.length ? selectedFits.map((f) => (
          <section key={f.id} className="mb-8 flex flex-col gap-3" data-testid="fit-panel">
            <div className="flex items-end justify-between">
              <div className="flex flex-col gap-1">
                <p className="mono text-graphite">{monoDate(f.date)}{p.scope === "family" ? ` · ${f.ownerName.toUpperCase()}` : ""}</p>
                {f.canEdit ? <button type="button" onClick={() => setSheet({ kind: "title", fitId: f.id })} className="text-left" data-testid="fit-title"><Title title={f.title} /></button> : <Title title={f.title} />}
              </div>
              {f.canEdit ? <button type="button" onClick={() => setSheet({ kind: "share", fitId: f.id })} className="pill pill-sm" data-testid="share">Share</button> : null}
            </div>
            <div className="grid grid-cols-3 grid-rows-[112px_112px] gap-1">
              <div className="col-span-2 row-span-2 overflow-hidden bg-bone">
                {f.photoKey ? <img src={`/api/photo/${f.photoKey}`} alt="Photo from the night" className="size-full object-cover" /> : (
                  <button type="button" disabled={!f.canEdit || busy === "photo"} onClick={() => { photoFor.current = f.id; file.current?.click(); }} className="flex size-full flex-col items-center justify-center gap-2" data-testid="photo-empty">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.4" strokeLinejoin="round" aria-hidden><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
                    <span className="mono">{busy === "photo" ? "Saving…" : f.canEdit ? "Your photo from the night" : "No photo from the night"}</span>
                  </button>
                )}
              </div>
              {f.pieces.slice(0, 2).map((x) => <div key={x.id} className="overflow-hidden bg-bone">{x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt={x.name} className="size-full object-cover" /> : <div className="flex size-full items-end p-2"><span className="mono text-graphite">{x.name}</span></div>}</div>)}
              {f.pieces.length < 2 ? Array.from({ length: 2 - f.pieces.length }, (_, i) => <div key={i} className="bg-bone" />) : null}
            </div>
            {f.pieces.length > 2 ? <p className="mono text-graphite">{f.pieces.map((x) => x.label).join(" · ")}</p> : null}
            <p className="mono text-graphite" data-testid="visibility">{f.visibility}</p>
            {f.canEdit && f.date <= p.today ? <RatingRow rating={f.rating} disabled={busy !== null} onRate={(r) => run("rate", () => rateFitAction(f.id, r))} /> : null}
            {f.canEdit ? (
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-[50px]" disabled={busy !== null} onClick={() => { setPicked(f.pieces.map((x) => x.id)); setPickTitle(f.title); setSheet({ kind: "pick", fitId: f.id }); }} data-testid="save-the-fit">Change pieces</Button>
                <Button variant="secondary" className="h-[50px]" disabled={busy !== null} onClick={() => { photoFor.current = f.id; file.current?.click(); }} data-testid="add-photo">{f.photoKey ? "Change photo" : "Add photo"}</Button>
              </div>
            ) : null}
            {f.canEdit ? <div className="flex justify-between"><button type="button" onClick={() => setSheet({ kind: "remove", fitId: f.id })} className="pill pill-sm pill-quiet">Remove fit</button>{f.photoKey ? <button type="button" onClick={() => run("photo", () => setFitPhotoAction(f.id, null))} className="pill pill-sm pill-quiet">Remove photo</button> : null}</div> : null}
          </section>
        )) : (
          <section className="flex flex-col gap-3" data-testid="fit-empty">
            <p className="mono text-graphite">{monoDate(p.selected)}{p.scope === "family" ? "" : ` · ${p.personName.toUpperCase()}`}</p>
            <p className="serif text-[30px] leading-none">Nothing <em>yet</em></p>
            <div className="grid grid-cols-3 grid-rows-[112px_112px] gap-1"><div className="col-span-2 row-span-2 bg-bone" /><div className="bg-bone" /><div className="bg-bone" /></div>
            {canSaveHere ? (
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-[50px]" onClick={() => { setPicked([]); setPickTitle(""); setSheet({ kind: "pick" }); }} data-testid="save-the-fit">Save the fit</Button>
                <Button variant="secondary" className="h-[50px]" disabled>Add photo</Button>
              </div>
            ) : <p className="text-[14px] leading-snug text-graphite">{p.scope === "family" ? "No fits shared with you on this day." : p.selected > p.today ? "That day hasn’t happened yet." : `${p.personName} didn’t save a fit this day.`}</p>}
          </section>
        )}
      </div>

      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && photoFor.current) uploadPhoto(photoFor.current, f); e.target.value = ""; }} />

      {/* SAVE THE FIT: pick pieces from the closet, name it. */}
      <Sheet open={sheet?.kind === "pick"} onClose={() => setSheet(null)} title={sheet?.fitId ? "Change pieces" : "Save the fit"}>
        <label className="mono block text-graphite" htmlFor="fit-title">Name</label>
        <input id="fit-title" value={pickTitle} onChange={(e) => setPickTitle(e.target.value)} placeholder="Dinner out" maxLength={60} className="mb-4 w-full border-b border-ink bg-transparent pb-2 text-[17px] outline-none" />
        <p className="mono mb-2 text-graphite">{picked.length} {picked.length === 1 ? "piece" : "pieces"} picked</p>
        <div className="grid grid-cols-3 gap-1" role="listbox" aria-multiselectable>
          {p.closet.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button key={c.id} type="button" role="option" aria-selected={on} onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])} className={cn("relative h-[112px] overflow-hidden bg-bone", on && "outline outline-2 -outline-offset-2 outline-ink")} data-testid={`pick-${c.id}`}>
                {c.thumbKey ? <img src={`/api/photo/${c.thumbKey}`} alt={c.name} className="size-full object-cover" /> : <span className="mono absolute bottom-1 left-1 right-1 truncate text-left text-graphite">{c.name}</span>}
                {on ? <span className="mono absolute left-1 top-1 bg-ink px-1 text-paper">✓</span> : null}
              </button>
            );
          })}
        </div>
        {p.closet.length === 0 ? <p className="mono py-4 text-graphite">Nothing in the closet yet</p> : null}
        <Button className="mt-4 w-full" disabled={busy !== null || picked.length === 0} onClick={() => run("save", () => saveFitAction(p.personId, p.selected, picked, pickTitle), () => setSheet(null))} data-testid="confirm-save-fit">{busy === "save" ? "Saving…" : "Save the fit"}</Button>
      </Sheet>

      <PickSheet open={sheet?.kind === "share"} onClose={() => setSheet(null)} title="Who can see this fit" kind="tag" options={p.people} selected={selectedFits.find((f) => f.id === sheet?.fitId)?.viewerIds ?? []} multi canAdd={false} onChange={(ids) => run("share", () => setFitViewersAction(sheet!.fitId!, ids))} />
      <TextSheet open={sheet?.kind === "title"} onClose={() => setSheet(null)} title="Name this fit" label="Name" value={selectedFits.find((f) => f.id === sheet?.fitId)?.title ?? ""} onSave={(v) => run("title", () => setFitTitleAction(sheet!.fitId!, v))} />
      <Sheet open={sheet?.kind === "remove"} onClose={() => setSheet(null)} title="Remove this fit?">
        <p className="text-[14px] leading-snug text-graphite">The pieces go back to their previous wear counts. The photo is deleted.</p>
        <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setSheet(null)}>Keep it</Button><Button onClick={() => run("remove", () => deleteFitAction(sheet!.fitId!), () => setSheet(null))}>Remove</Button></div>
      </Sheet>
    </div>
  );
}
