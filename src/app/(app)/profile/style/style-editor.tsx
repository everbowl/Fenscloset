"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { PickSheet, Row } from "@/components/items/row-editor";
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
  const open = (k: typeof sheet) => canEdit && setSheet(k);
  return (
    <div className="space-y-6">
      {error ? <Banner tone="danger" title={error} /> : null}
      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Colors</p>
        <Row label="Loved" value={names(colors, style.lovedColorIds) || "Pick colors"} muted={!style.lovedColorIds.length} onClick={() => open("loved")} testId="row-loved" trailing={<Swatches colors={colors} ids={style.lovedColorIds} />} />
        <Row label="Avoid" value={names(colors, style.avoidColorIds) || "None"} muted={!style.avoidColorIds.length} onClick={() => open("avoid")} trailing={<Swatches colors={colors} ids={style.avoidColorIds} />} />
      </section>
      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Style</p>
        <Row label="Words" value={names(wordList, style.styleWordIds) || "Pick words"} muted={!style.styleWordIds.length} onClick={() => open("words")} />
      </section>
      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Never suggest</p>
        {style.neverSuggest.length === 0 ? <p className="mono py-3 text-graphite">Nothing excluded · turn off “Suggest it” on a piece in <Link href="/closet" className="text-ink underline underline-offset-4">the closet</Link></p> : null}
        {style.neverSuggest.map((it) => (
          <div key={it.id} className="flex h-[42px] items-center justify-between border-b border-line">
            <Link href={`/closet/${it.id}`} className="truncate text-[14px]">{it.name ?? "Untitled piece"}</Link>
            {canEdit ? <button type="button" className="pill pill-sm ml-3 shrink-0" onClick={() => start(async () => { await setNeverSuggestAction(ownerId, it.id, false); router.refresh(); })}>Suggest again</button> : null}
          </div>
        ))}
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
