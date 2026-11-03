"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PickSheet } from "@/components/items/row-editor";
import { setShopSectionAction } from "@/app/(app)/profile/actions";
import { cn } from "@/lib/cn";

type Named = { id: string; name: string };

/**
 * Which part of a store the person being shopped for shops in (Jeff, 2 Nov 2026). Unset: a one-tap ask
 * right on the Shop, nobody leaves the page to fix it. Set: a small pill under the title that opens the list.
 * Anyone who may shop for the person may pick it (the person, a parent of a minor, a shopper they allowed).
 */
export function SectionPick({ personId, forName, mine, section, sections, isAdmin, className, bare = false }: {
  personId: string; forName: string; mine: boolean; section: Named | null; sections: Named[]; isAdmin: boolean; className?: string;
  /** Only the pills, for a row that already asks the question (the Closet's What's-needed strip). */ bare?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const [error, setError] = useState<string>();
  const pick = (id: string | null) => { setOpen(false); setError(undefined); start(async () => { const r = await setShopSectionAction(personId, id); if (!r.ok) setError(r.error); router.refresh(); }); };
  const sheet = <PickSheet open={open} onClose={() => setOpen(false)} title={mine ? "I shop in" : `${forName} shops in`} kind="shopSection" options={sections} selected={section ? [section.id] : []} canAdd={isAdmin} onChange={(ids) => pick(ids[0] ?? null)} clearable={Boolean(section)} />;
  if (!section) {
    const pills = (
      <div className={cn("flex flex-wrap gap-2", !bare && "mt-2.5")}>
        {sections.map((s) => <button key={s.id} type="button" onClick={() => pick(s.id)} className="pill pill-sm" data-testid={`section-${s.name}`}>{s.name}</button>)}
        {isAdmin ? <button type="button" onClick={() => setOpen(true)} className="pill pill-sm pill-quiet">Another…</button> : null}
      </div>
    );
    const note = error ? <p className="mono mt-2 text-danger" role="alert">{error}</p> : null;
    if (bare) return <>{pills}{note}{sheet}</>;
    return (
      <div className={cn("border-y border-ink py-3", className)} data-testid="shop-section-ask">
        <p className="mono text-ink">Which section {mine ? "do you" : `does ${forName}`} shop in?</p>
        <p className="mono mt-1 text-graphite">Every store search carries it, so the other section stays out.</p>
        {pills}
        {note}
        {sheet}
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("pill pill-sm pill-quiet", className)} aria-haspopup="dialog" data-testid="shop-section">{section.name} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="m6 9 6 6 6-6" /></svg></button>
      {error ? <p className="mono text-danger" role="alert">{error}</p> : null}
      {sheet}
    </>
  );
}
