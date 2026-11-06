"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextSheet } from "@/components/items/row-editor";
import { toast } from "@/components/ui/toast";
import { MirrorSheet } from "@/components/mirror/mirror-sheet";
import { useMirror } from "@/components/mirror/use-mirror";
import { cn } from "@/lib/cn";
import { MAX_LOOK_PIECES, type LookView } from "@/lib/looks/shared";
import type { TryOnState } from "@/lib/tryon";
import type { Engine } from "@/lib/tryon/engines";
import { addPiecesAction, deleteLookAction, removePieceAction, saveLookAction } from "../actions";

type ClosetPiece = { id: string; name: string; thumbKey: string | null; categoryName: string | null };
type Look = Omit<LookView, "savedAt"> & { savedAt: string | null };

/**
 * A look (Jeff, 2 Nov 2026, B1): things to buy and things you own, together. Each store piece keeps its Buy link;
 * See it on me / on a mannequin dresses the mix (the store pictures ride along); Add from the closet picks more of
 * what the person owns; Name and save puts it under Fits → Looks. The open look (no name yet) is what the tray on
 * the Shop and the closet points at.
 */
export function LookScreen({ look, meId, tryOn, mannequin, backPhoto, engine, admin, closet }: {
  look: Look; meId: string; tryOn: TryOnState; mannequin: boolean; backPhoto: boolean; engine: Engine; admin: boolean; closet: ClosetPiece[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"name" | "closet" | "remove" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickCat, setPickCat] = useState<string | null>(null);
  const m = useMirror(look.personId, undefined, engine);
  const mine = look.personId === meId;
  const onMe = mine && tryOn === "ready";
  const saved = Boolean(look.savedAt);
  const names = look.pieces.map((p) => p.name).join(" · ");
  const room = Math.max(0, MAX_LOOK_PIECES - look.pieces.length);
  const inLook = new Set(look.pieces.flatMap((p) => (p.itemId ? [p.itemId] : [])));
  const run = (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, then?: () => void) => {
    setBusy(key);
    start(async () => { const r = await fn(); setBusy(null); if (!r.ok) { toast.error(r.error ?? "Something went wrong."); return; } then?.(); router.refresh(); });
  };
  const words = (look.name ?? "New look").trim().split(" ");
  const last = words.pop() ?? "";

  return (
    <div data-testid="look" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="lg:col-span-2">
        <PageHeader eyebrow={<span className="text-graphite" data-testid="look-eyebrow">{mine ? "My look" : `${look.personName}’s look`}{saved ? " · saved under Fits" : " · not saved yet"}</span>} title={words.join(" ")} accent={last} />
      </div>

      <section className="lg:col-start-1" data-testid="look-pieces">
        {look.pieces.length ? look.pieces.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border-b border-line py-2" data-testid="look-piece" data-kind={p.kind}>
            <div className="h-[72px] w-[56px] shrink-0 overflow-hidden bg-bone">
              {p.thumbKey ? <img src={`/api/photo/${p.thumbKey}`} alt="" className="size-full object-cover" /> : p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px]">{p.name}</p>
              <p className="mono truncate text-graphite">{p.kind === "store" ? [p.priceText, p.storeName, "to buy"].filter(Boolean).join(" · ") : [p.category, "in the closet"].filter(Boolean).join(" · ")}</p>
            </div>
            {p.kind === "store" && p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm shrink-0" aria-label={`Buy ${p.name}`}>Buy ↗</a> : null}
            {look.canEdit ? <button type="button" onClick={() => run(`rm-${p.id}`, () => removePieceAction(look.id, p.id))} disabled={busy !== null} className="flex size-11 shrink-0 items-center justify-center text-[22px] leading-none text-graphite" aria-label={`Take out ${p.name}`} data-testid="look-remove">×</button> : null}
          </div>
        )) : <p className="mono py-6 text-graphite" data-testid="look-empty">Nothing in this look yet. Tap ADD TO A LOOK on a store find, or add from the closet.</p>}
        <p className="mono mt-2 text-graphite" data-testid="look-line">
          {look.pieces.length} of {MAX_LOOK_PIECES}{look.toBuy ? ` · ${look.toBuy} to buy${look.total !== null ? ` · about $${look.total}` : ""}` : ""}
        </p>
        {look.pieces.length > 3 ? <p className="mono mt-1 text-graphite">The mirror dresses up to three of them: a top, a bottom, shoes. The rest stay on the list.</p> : null}
      </section>

      <aside className="mt-6 flex flex-col gap-2 lg:col-start-2 lg:mt-0">
        {(onMe || mannequin) && look.pieces.length ? (
          <Button size="lg" className="w-full" disabled={m.busy} onClick={() => m.begin({ look: { kind: "look", lookId: look.id }, on: onMe ? "me" : "mannequin" })} data-testid={onMe ? "look-see-on-me" : "look-see-on-mannequin"}>
            {m.busy ? "Dressing…" : onMe ? "See it on me" : "See it on a mannequin"}
          </Button>
        ) : null}
        {look.canEdit ? <button type="button" onClick={() => { setPicked([]); setSheet("closet"); }} className="pill h-[50px] w-full" data-testid="look-add-closet">Add from {mine ? "my" : `${look.personName}’s`} closet</button> : null}
        {look.canEdit ? <button type="button" onClick={() => setSheet("name")} className="pill h-[50px] w-full" data-testid={saved ? "look-rename" : "look-save"}>{saved ? "Rename" : "Name and save"}</button> : null}
        {saved ? <Link href="/fits" className="mono text-graphite underline underline-offset-4">All looks under Fits</Link> : <p className="mono text-graphite">Saved looks live under Fits → Looks.</p>}
        {look.canEdit ? <button type="button" onClick={() => setSheet("remove")} className="pill pill-sm pill-quiet self-start" data-testid="look-delete">{saved ? "Remove look" : "Start over"}</button> : null}
      </aside>

      <TextSheet open={sheet === "name"} onClose={() => setSheet(null)} title={saved ? "Rename the look" : "Name the look"} label="Name" value={look.name ?? ""} placeholder="Date night · Vegas trip · First day" submitLabel={saved ? "Save" : "Save the look"}
        onSave={(v) => run("save", () => saveLookAction(look.id, v), () => { setSheet(null); toast.ok(saved ? "Renamed" : "Saved under Fits"); })} />
      <Sheet open={sheet === "remove"} onClose={() => setSheet(null)} title={saved ? "Remove this look?" : "Start over?"}>
        <div className="flex flex-col gap-3 py-3">
          <p className="text-[15px] leading-snug">{saved ? "The look goes. Your clothes and the stores’ pieces stay where they are." : "Everything comes out of the look."}</p>
          <Button variant="danger" className="w-full" disabled={busy !== null} onClick={() => run("delete", () => deleteLookAction(look.id), () => router.push(saved ? "/fits" : `/shop?for=${look.personId}`))} data-testid="look-delete-confirm">{saved ? "Remove look" : "Start over"}</Button>
        </div>
      </Sheet>
      <Sheet open={sheet === "closet"} onClose={() => setSheet(null)} title="Add from the closet"
        footer={<Button className="w-full" busy={busy === "add"} disabled={busy !== null || !picked.length} onClick={() => run("add", () => addPiecesAction(look.id, picked), () => { setSheet(null); toast.ok(`Added ${picked.length}`); })} data-testid="look-add-picked">{busy === "add" ? "Adding…" : picked.length ? `Add ${picked.length}` : room ? `Pick up to ${room}` : "The look is full"}</Button>}>
        <div className="-mx-5 flex gap-4 overflow-x-auto px-5" role="tablist">
          {["All", ...Array.from(new Set(closet.map((c) => c.categoryName).filter(Boolean) as string[]))].map((c) => (
            <button key={c} type="button" role="tab" aria-selected={(pickCat ?? "All") === c} onClick={() => setPickCat(c === "All" ? null : c)} className={cn("mono mono-11 flex min-h-11 shrink-0 items-center", (pickCat ?? "All") === c ? "text-ink" : "text-graphite")}><span className={cn("py-1", (pickCat ?? "All") === c && "border-b-[1.5px] border-ink")}>{c}</span></button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1 pt-2" role="listbox" aria-multiselectable>
          {closet.filter((c) => !pickCat || c.categoryName === pickCat).map((c) => {
            const on = picked.includes(c.id), already = inLook.has(c.id);
            return (
              <button key={c.id} type="button" role="option" aria-selected={on} disabled={already || (!on && picked.length >= room)} onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])} className={cn("relative h-[112px] overflow-hidden bg-bone", on && "outline outline-2 -outline-offset-2 outline-ink", already && "opacity-50")} data-testid={`look-pick-${c.id}`}>
                {c.thumbKey ? <img src={`/api/photo/${c.thumbKey}`} alt={c.name} className="size-full object-cover" /> : <span className="mono absolute inset-x-1 bottom-1 truncate text-left text-graphite">{c.name}</span>}
                {already ? <span className="mono absolute left-1 top-1 bg-paper px-1 py-0.5">In the look</span> : null}
              </button>
            );
          })}
        </div>
        {closet.length === 0 ? <div className="flex flex-col items-start gap-3 py-4"><p className="mono text-graphite">Nothing in the closet yet</p><Link href="/add" className="pill">+ Add clothes</Link></div> : null}
      </Sheet>
      <MirrorSheet m={m} pieces={names} mine={mine} personId={look.personId} personName={look.personName} tryOnState={tryOn} backPhoto={backPhoto} mannequinAvailable={mannequin} admin={admin} />
    </div>
  );
}
