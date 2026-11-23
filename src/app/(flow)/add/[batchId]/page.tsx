import { listMyBrands } from "@/lib/profiles/brands";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { openBatch } from "@/lib/import/service";
import { loadTagLists } from "@/lib/ai/tag-item";
import { findLikelyDuplicate } from "@/lib/items/duplicates";
import type { EntryAiResult } from "@/lib/import/process";
import { emptyTags, isSure } from "@/lib/items/service";
import { CrumbLabel } from "@/components/crumbs";
import { ConfirmCard } from "./confirm-card";
import { Waiting } from "./waiting";
import { buttonClass } from "@/components/ui/button-class";
import { FailedActions } from "./failed-actions";

export const metadata = { title: "Review" };
export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(3, "0");

export default async function ConfirmPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ entry?: string }> }) {
  const person = await requirePerson();
  const { batchId } = await params;
  const { entry: wanted } = await searchParams;
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.personId !== person.id) notFound();

  // This batch, not whichever open batch is newest (review B B10).
  const summary = batch.status === "open" ? await openBatch(person.id, batchId) : null;
  const added = await db.importEntry.count({ where: { batchId, status: "done" } });

  let entryId = summary?.nextConfirmId ?? null;
  if (wanted && summary) {
    const w = await db.importEntry.findUnique({ where: { id: wanted }, select: { batchId: true, status: true } });
    if (w?.batchId === batchId && w.status === "needs_confirm") entryId = wanted;
  }

  if (!summary || !entryId) {
    const working = summary ? summary.counts.queued + summary.counts.uploaded + summary.counts.processing : 0;
    if (summary && working > 0) return <><CrumbLabel label={`Review · ${working} tagging`} /><Waiting working={summary.working} added={added} total={summary.total} batchId={batchId} /></>;
    return (
      <div className="flex flex-1 flex-col px-5 pb-[26px] pt-6">
        <CrumbLabel label="Review · done" />
        <Link href="/add" aria-label="Back to add" className="-ml-3 flex size-11 items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M5 5l14 14M19 5 5 19" /></svg>
        </Link>
        <h1 className="title mt-6">All done</h1>
        <p className="mono mt-3 text-graphite">{added} added to your closet</p>
        {summary && summary.counts.failed > 0 ? <FailedActions batchId={batchId} ids={summary.failed.map((f) => f.id)} error={summary.failed[0].error} /> : null}
        <div className="mt-auto flex flex-col gap-2.5">
          <Link href={added ? `/closet?added=${added}` : "/closet"} className={buttonClass({ size: "lg", className: "w-full" })}>Go to closet <span aria-hidden>→</span></Link>
          <Link href="/add" className="pill h-[50px] w-full">Add more photos</Link>
        </div>
      </div>
    );
  }

  // The card may have been confirmed from another tab since openBatch chose it (review B F11): start over on the next one, no error page.
  const entry = await db.importEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.status !== "needs_confirm") redirect(`/add/${batchId}`);
  const ai = (entry.aiResult as EntryAiResult | null) ?? { tags: emptyTags(), warnings: [] };
  const [lists, myBrands, waiting] = await Promise.all([
    loadTagLists(),
    listMyBrands(person, person.id),
    db.importEntry.findMany({ where: { batchId, status: "needs_confirm" }, select: { aiResult: true } }),
  ]);
  // Decided during processing (photo matches confirmed by Claude); older entries fall back to the hash-and-tags check.
  const duplicate = ai.duplicate !== undefined ? ai.duplicate : await findLikelyDuplicate(person.id, { phash: entry.phash, categoryId: ai.tags.categoryId, colorIds: ai.tags.colorIds, brandId: ai.tags.brandId });
  const position = summary.position;
  const left = summary.counts.needs_confirm;
  // "Add all" only when every card still waiting is sure of itself (a category, a color, the tagger's confidence).
  const allSure = left > 1 && waiting.every((w) => isSure(((w.aiResult as EntryAiResult | null)?.tags) ?? emptyTags()));

  return (
    <>
      <CrumbLabel label={left > 1 ? `Review · ${left} left` : "Review"} />
      <ConfirmCard
        key={entry.id}
        batchId={batchId}
        entry={{ id: entry.id, photoKey: entry.cutoutKey ?? entry.originalKey, labelKey: entry.labelKey, wornKey: entry.wornKey, backKey: entry.backKey, retailKeys: entry.retailKeys, warnings: ai.warnings, error: entry.error }}
        myBrands={myBrands}
        tags={ai.tags}
        lists={lists}
        counter={`${pad(position)} / ${pad(summary.total)}`}
        progress={summary.total ? Math.round(((position - 1) / summary.total) * 100) : 0}
        duplicate={duplicate}
        canEditLists={isAdmin(person)}
        readyCount={left}
        allSure={allSure}
      />
    </>
  );
}
