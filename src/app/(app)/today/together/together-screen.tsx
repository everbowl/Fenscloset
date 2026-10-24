"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { PickSheet, TextSheet } from "@/components/items/row-editor";
import { cn } from "@/lib/cn";
import type { TogetherView } from "@/lib/outfits/together";
import type { TogetherMode } from "@/generated/prisma/client";
import { dressTogetherAction, wearTogetherAction } from "./actions";

const MODES: { key: TogetherMode; label: string; blurb: string }[] = [
  { key: "coordinate", label: "Coordinate", blurb: "Same mood, complementary colors" },
  { key: "match", label: "Match", blurb: "Clearly matching colors or pieces" },
  { key: "contrast", label: "Contrast", blurb: "Deliberately different, still together" },
];

export function TogetherScreen({ meId, people, canDressIds, occasions, isAdmin, session }: {
  meId: string; people: { id: string; name: string }[]; canDressIds: string[]; occasions: { id: string; name: string }[]; isAdmin: boolean; session: TogetherView | null;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [ids, setIds] = useState<string[]>(session ? session.boards.map((b) => b.personId) : [meId]);
  const [mode, setMode] = useState<TogetherMode>(session?.mode ?? "coordinate");
  const [occasionId, setOccasionId] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(session?.occasionLabel ?? null);
  const [sheet, setSheet] = useState<"occasion" | "text" | null>(null);
  const [editing, setEditing] = useState(!session);

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; id?: string }>) {
    setError(undefined); setBusy(label);
    start(async () => {
      const r = await fn(); setBusy(null);
      if (!r.ok) setError(r.error); else { setEditing(false); if (r.id) router.replace(`/today/together?s=${r.id}`); }
      router.refresh();
    });
  }
  const planLabel = occasionId ? occasions.find((o) => o.id === occasionId)?.name ?? null : text;

  return (
    <div data-testid="together">
      <PageHeader title="Going out" accent="together" aside={session && !editing ? <button type="button" onClick={() => setEditing(true)} className="mono mono-11 text-ink">Change</button> : undefined} />
      {error ? <Banner tone="danger" title={error} className="mb-3" /> : null}

      {editing ? (
        <div className="space-y-6 lg:max-w-[560px]">
          <section>
            <p className="mono border-b border-ink pb-2 text-graphite">Who</p>
            {people.map((p) => {
              const on = ids.includes(p.id);
              return (
                <button key={p.id} type="button" role="checkbox" aria-checked={on} onClick={() => setIds(on ? ids.filter((x) => x !== p.id) : [...ids, p.id])} className="flex h-[42px] w-full items-center justify-between border-b border-line text-[14px]" data-testid={`together-person-${p.name}`}>
                  <span>{p.name}{p.id === meId ? " (me)" : ""}</span><span className={cn("mono", on ? "text-ink" : "text-transparent")}>✓</span>
                </button>
              );
            })}
          </section>
          <section>
            <p className="mono border-b border-ink pb-2 text-graphite">How</p>
            <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mode">
              {MODES.map((m) => <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)} className={cn("mono mono-11 h-[46px] border border-ink uppercase", mode === m.key ? "bg-ink text-paper" : "bg-paper text-ink")} data-testid={`mode-${m.key}`}>{m.label}</button>)}
            </div>
            <p className="mono mt-2 text-graphite">{MODES.find((m) => m.key === mode)?.blurb}</p>
          </section>
          <section>
            <p className="mono border-b border-ink pb-2 text-graphite">Plan</p>
            <button type="button" onClick={() => setSheet("occasion")} className="flex h-[42px] w-full items-center border-b border-line text-left" data-testid="together-plan">
              <span className="mono w-[120px] shrink-0 text-graphite">Occasion</span>
              <span className={cn("flex-1 truncate text-[14px]", !planLabel && "text-graphite")}>{planLabel ?? "Pick one"}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
            </button>
            <button type="button" onClick={() => setSheet("text")} className="mono mono-11 mt-2">Something else…</button>
          </section>
          <Button size="lg" className="w-full" disabled={busy !== null || ids.length < 2} onClick={() => run("dress", () => dressTogetherAction({ personIds: ids, mode, occasionId, occasionText: occasionId ? null : text }))} data-testid="dress-us">{busy === "dress" ? "Thinking…" : "Dress us"}</Button>
          {ids.length < 2 ? <p className="mono text-center text-graphite">Pick at least two people</p> : null}
        </div>
      ) : null}

      {session && !editing ? (
        <div className="space-y-7 lg:grid lg:grid-cols-3 lg:gap-x-8 lg:space-y-0" data-testid="together-boards">
          <p className="mono text-graphite lg:col-span-3 lg:mb-4">{session.mode.toUpperCase()}{session.occasionLabel ? ` · ${session.occasionLabel.toUpperCase()}` : ""}</p>
          {session.boards.map((b) => (
            <section key={b.personId} data-testid={`together-board-${b.personName}`}>
              <p className="serif mb-2 text-[30px]">{b.personName}</p>
              <div className="grid grid-cols-2 grid-rows-[150px_150px] gap-1.5">
                {[0, 1, 2, 3].map((i) => {
                  const piece = b.pieces[i];
                  return (
                    <div key={i} className={cn("overflow-hidden bg-bone", i === 0 && "row-span-2")}>
                      {piece?.thumbKey ? <img src={`/api/photo/${piece.thumbKey}`} alt={piece.name} className="size-full object-cover" /> : piece ? <div className="flex size-full items-end p-2"><span className="mono text-graphite">{piece.name}</span></div> : null}
                    </div>
                  );
                })}
              </div>
              <p className="mono mt-3 text-graphite">{b.pieces.map((x) => x.label).join(" · ")}</p>
              <p className="mt-1 text-[16px] leading-snug">{b.board.reason}</p>
              {canDressIds.includes(b.personId) ? (
                b.wornFitId ? <Link href="/fits" className="mono mt-3 flex h-[46px] items-center justify-center border border-ink text-[11px] uppercase tracking-[0.14em]">Wearing this · see Fits</Link>
                : <Button className="mt-3 w-full" disabled={busy !== null} onClick={() => run(`wear-${b.personId}`, () => wearTogetherAction(b.personId, b.suggestionId, session.occasionLabel ?? "Together"))} data-testid={`wear-${b.personName}`}>{busy === `wear-${b.personId}` ? "Saving…" : `Wear this · ${b.personName}`}</Button>
              ) : null}
            </section>
          ))}
          {session.boards.length === 0 ? <p className="mono text-graphite">Nobody had enough clean pieces for a look. Add clothes or do laundry.</p> : null}
        </div>
      ) : null}

      <PickSheet open={sheet === "occasion"} onClose={() => setSheet(null)} title="Occasion" kind="occasion" options={occasions} selected={occasionId ? [occasionId] : []} canAdd={isAdmin} onChange={(x) => { setOccasionId(x[0] ?? null); if (x[0]) setText(null); }} />
      <TextSheet open={sheet === "text"} onClose={() => setSheet(null)} title="What’s the plan?" label="Plan" value={text ?? ""} placeholder="Grandma’s birthday" onSave={(v) => { setText(v); setOccasionId(null); }} />
    </div>
  );
}
