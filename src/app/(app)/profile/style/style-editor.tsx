"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { PickSheet, Row } from "@/components/items/row-editor";
import { ReadRow } from "@/components/profile/read-row";
import type { Named, StyleProfileView } from "@/lib/profiles/service";
import { setNeverSuggestAction, updateStyleAction } from "../actions";

/** Style profile (screen 12, undrawn): loved / avoid colors, style words, never-suggest list. */
export function StyleEditor({ ownerId, style, colors, words, canEdit, canEditLists }: { ownerId: string; style: StyleProfileView; colors: (Named & { hex?: string | null })[]; words: Named[]; canEdit: boolean; canEditLists: boolean }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"loved" | "avoid" | "words" | null>(null);
  const [wordList, setWordList] = useState(words);
  const [error, setError] = useState<string>();
  const [, start] = useTransition();
  const names = (xs: Named[], ids: string[]) => ids.map((id) => xs.find((x) => x.id === id)?.name).filter(Boolean).join(", ");
  function save(patch: { lovedColorIds?: string[]; avoidColorIds?: string[]; styleWordIds?: string[] }) {
    start(async () => { const r = await updateStyleAction(ownerId, patch); if (!r.ok) setError(r.error); router.refresh(); });
  }
  // A viewer with read access gets plain rows, never a tap that does nothing (review E G2).
  const row = (k: NonNullable<typeof sheet>, label: string, value: string, muted: boolean, testId?: string, trailing?: React.ReactNode) => canEdit
    ? <Row label={label} value={value} muted={muted} onClick={() => setSheet(k)} testId={testId} trailing={trailing} />
    : <ReadRow label={label} value={value} muted={muted} testId={testId} trailing={trailing} />;
  return (
    <div className="space-y-8">
      {error ? <Banner tone="danger" title={error} /> : null}
      <section>
        <h2 className="section">Colors</h2>
        <div className="card mt-3 px-4">
          {row("loved", "Loved", names(colors, style.lovedColorIds) || (canEdit ? "Pick colors" : "None yet"), !style.lovedColorIds.length, "row-loved", <Swatches colors={colors} ids={style.lovedColorIds} />)}
          {row("avoid", "Avoid", names(colors, style.avoidColorIds) || "None", !style.avoidColorIds.length, undefined, <Swatches colors={colors} ids={style.avoidColorIds} />)}
        </div>
      </section>
      <section>
        <h2 className="section">Style</h2>
        <div className="card mt-3 px-4">
          {row("words", "Words", names(wordList, style.styleWordIds) || (canEdit ? "Pick words" : "None yet"), !style.styleWordIds.length)}
        </div>
      </section>
      <section>
        <h2 className="section">Never suggest</h2>
        <div className="card mt-3 divide-y divide-line overflow-hidden p-0">
          {style.neverSuggest.length === 0 ? <p className="note px-4 py-3">Nothing excluded. Turn off “Suggest it” on a piece in <Link href="/closet" className="text-ink underline underline-offset-4">the closet</Link></p> : null}
          {style.neverSuggest.map((it) => (
            <div key={it.id} className="flex h-12 items-center justify-between gap-3 px-4">
              <Link href={`/closet/${it.id}`} className="truncate text-[15px]">{it.name ?? "Untitled piece"}</Link>
              {canEdit ? <button type="button" className="pill pill-sm shrink-0" onClick={() => start(async () => { await setNeverSuggestAction(ownerId, it.id, false); router.refresh(); })}>Suggest again</button> : null}
            </div>
          ))}
        </div>
      </section>
      <PickSheet open={sheet === "loved"} onClose={() => setSheet(null)} title="Loved colors" kind="color" options={colors.filter((c) => !style.avoidColorIds.includes(c.id))} selected={style.lovedColorIds} multi canAdd={false} onChange={(ids) => save({ lovedColorIds: ids })} />
      <PickSheet open={sheet === "avoid"} onClose={() => setSheet(null)} title="Colors to avoid" kind="color" options={colors.filter((c) => !style.lovedColorIds.includes(c.id))} selected={style.avoidColorIds} multi canAdd={false} onChange={(ids) => save({ avoidColorIds: ids })} />
      <PickSheet open={sheet === "words"} onClose={() => setSheet(null)} title="Style words" kind="styleWord" options={wordList} selected={style.styleWordIds} multi canAdd={canEditLists} onChange={(ids) => save({ styleWordIds: ids })} onAdded={(e) => setWordList((l) => [...l, e])} />
    </div>
  );
}

/** The picked colors as dots, next to their names. */
function Swatches({ colors, ids }: { colors: { id: string; hex?: string | null }[]; ids: string[] }) {
  const hexes = ids.map((id) => colors.find((c) => c.id === id)?.hex).filter(Boolean) as string[];
  if (!hexes.length) return null;
  return <span className="flex shrink-0 gap-1" aria-hidden>{hexes.slice(0, 5).map((h, i) => <span key={i} className="size-3.5 rounded-full border border-line" style={{ background: h }} />)}</span>;
}
