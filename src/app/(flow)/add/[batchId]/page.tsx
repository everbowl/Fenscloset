import { isSmoothConfigured } from "@/lib/images/smooth";
import { listMyBrands } from "@/lib/profiles/brands";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { openBatch } from "@/lib/import/service";
import { loadTagLists } from "@/lib/ai/tag-item";
import { findLikelyDuplicate } from "@/lib/items/duplicates";
import type { EntryAiResult } from "@/lib/import/process";
import { emptyTags } from "@/lib/items/service";
import { ConfirmCard } from "./confirm-card";
import { Waiting } from "./waiting";

export const metadata = { title: "Confirm" };
export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(3, "0");

export default async function ConfirmPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ entry?: string }> }) {
  const person = await requirePerson();
  const { batchId } = await params;
  const { entry: wanted } = await searchParams;
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.personId !== person.id) notFound();

  const summary = batch.status === "open" ? await openBatch(person.id) : null;
  const added = await db.importEntry.count({ where: { batchId, status: "done" } });

  let entryId = summary?.nextConfirmId ?? null;
  if (wanted && summary) {
    const w = await db.importEntry.findUnique({ where: { id: wanted }, select: { batchId: true, status: true } });
    if (w?.batchId === batchId && w.status === "needs_confirm") entryId = wanted;
  }

  if (!summary || !entryId) {
    const working = summary ? summary.counts.queued + summary.counts.uploaded + summary.counts.processing : 0;
    if (summary && working > 0) return <Waiting working={working} added={added} total={summary.total} batchId={batchId} />;
    return (
      <div className="flex flex-1 flex-col px-5 pb-[26px] pt-6">
        <Link href="/add" aria-label="Back to add" className="-ml-3 flex size-11 items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M5 5l14 14M19 5 5 19" /></svg>
        </Link>
        <h1 className="serif mt-6 text-[44px]">All <em>done</em></h1>
        <p className="mono mt-3 text-graphite">{pad(added)} added to your closet{summary ? ` · ${pad(summary.counts.failed)} could not be tagged` : ""}</p>
        <div className="mt-auto flex flex-col gap-2.5">
          <Link href="/closet" className="flex h-[54px] items-center justify-center bg-ink font-mono text-[12px] uppercase tracking-[0.16em] text-paper">Go to closet</Link>
          <Link href="/add" className="flex h-[50px] items-center justify-center border border-ink font-mono text-[11px] uppercase tracking-[0.14em] text-ink">Add more photos</Link>
        </div>
      </div>
    );
  }

  const entry = await db.importEntry.findUniqueOrThrow({ where: { id: entryId } });
  const ai = (entry.aiResult as EntryAiResult | null) ?? { tags: emptyTags(), warnings: [] };
  const [lists, myBrands] = await Promise.all([loadTagLists(), listMyBrands(person.id)]);
  const duplicate = await findLikelyDuplicate(person.id, { phash: entry.phash, categoryId: ai.tags.categoryId, colorIds: ai.tags.colorIds, brandId: ai.tags.brandId });
  const position = summary.position;

  return (
    <ConfirmCard
      key={entry.id}
      batchId={batchId}
      entry={{ id: entry.id, photoKey: entry.cutoutKey ?? entry.originalKey, labelKey: entry.labelKey, wornKey: entry.wornKey, backKey: entry.backKey, smoothKey: entry.smoothKey, retailKeys: entry.retailKeys, warnings: ai.warnings }}
      canSmooth={isSmoothConfigured()}
      myBrands={myBrands}
      tags={ai.tags}
      lists={lists}
      counter={`${pad(position)} / ${pad(summary.total)}`}
      progress={summary.total ? Math.round(((position - 1) / summary.total) * 100) : 0}
      duplicate={duplicate}
      canEditLists={isAdmin(person)}
      readyCount={summary.counts.needs_confirm}
    />
  );
}
